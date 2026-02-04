# Sidebar Visibility: Root Cause and Role-Safe Design

## Why the behavior happens internally

### 1. **Single run at load, no per-session reset**

Sidebar visibility is driven by `data-hide-cm-sidebar` on `document.body` (`true` = hide restricted items for HR/LM/Admin, `false` = show all for Super Admin, `pending` = hide until we know).

- **setBodyFlagImmediately()** runs once when the plugin’s admin `index.js` is **loaded** (synchronous, at script parse time).
- At that moment, **Redux may not exist yet** (`window.strapi.store` is set when the Strapi app mounts), so the script often falls back to `sessionStorage` or “unknown”.
- The body flag is **never recomputed** from scratch on login/logout unless something else (e.g. Redux subscriber, `runHideLogic`, visiting All Modules) runs later. So the **first paint** uses whatever was set at load or left over from the previous session.

### 2. **sessionStorage leaks across role switch**

- We store `__is_super_admin__` and `__modules_sidebar_roles__` in `sessionStorage` to survive navigations.
- On **logout** we clear `__is_super_admin__` (and sometimes `__modules_sidebar_roles__`), but:
  - The **DOM still has** `data-hide-cm-sidebar="false"` from the previous (Super Admin) session until something overwrites it.
  - When the **new** user (e.g. HR Admin) loads the app, the script runs again. If we treat “no value in sessionStorage” as “show all” (e.g. set flag to `false`), HR Admin incorrectly sees the full sidebar until Redux/All Modules updates the flag.

So: **clearing storage on logout is not enough**; we must also set the body flag to a safe value (`pending`) and **never** treat “unknown” as “show all”.

### 3. **“Unknown” was treated as “show all”**

In **setBodyFlagBeforeRender()**, when `sessionStorage.getItem('__is_super_admin__')` is `null` (e.g. after logout or first load), the code used to set:

```js
document.body.setAttribute('data-hide-cm-sidebar', 'false');
```

So “unknown” was interpreted as “Super Admin” and all options were shown. That causes:

- After logout → login as HR/LM/Admin: they see the previous Super Admin sidebar until something else (e.g. All Modules) recomputes the flag.
- After restart, first login as Super Admin: if Redux isn’t ready and storage is empty, we could set `pending` first and then overwrite with `false` here, which is inconsistent and can lead to partial UI depending on timing.

### 4. **When sidebar state is stored and recomputed**

| What | Where | When |
|------|--------|------|
| **DOM** | `document.body.getAttribute('data-hide-cm-sidebar')` | Set at plugin load (`setBodyFlagImmediately`, `setBodyFlagBeforeRender`) and later by Redux subscriber, `runHideLogic`, `getRoles()`, `detectInitialRoles()`. |
| **Session cache** | `sessionStorage.__is_super_admin__`, `__modules_sidebar_roles__` | Written when we resolve roles (Redux or API); cleared on logout/user change. |
| **In-memory** | `cachedRoles`, `lastToken`, `lastUserId`, `window.__MODULES_SIDEBAR_ROLES__` | Updated by Redux subscriber, `getRoles()`, AllModules page; cleared on logout/user change. |

Recompute happens only when:

- Redux store updates and our **store.subscribe** callback runs (login, logout, token refresh).
- Something calls **runHideLogic** or **getRoles()** (e.g. timers, MutationObserver, visiting All Modules).

So the **first render** often uses whatever was set at load or left in the DOM from the previous session; it is **not** guaranteed to be recomputed from the current user before paint.

### 5. **Lazy loading and timing**

- Strapi admin loads the app and then populates the store (token, user, roles) asynchronously after login.
- The plugin runs at bundle load time; the store may not be ready, so the initial flag is based on storage or “unknown”.
- If we default “unknown” to “show all”, we get the wrong first paint for non–Super Admin users. If we default to “pending”, Super Admin may see a restricted view until the Redux subscriber runs with roles. So we need: **unknown → pending**, and **Redux subscriber must run as soon as the store is available** and set the flag as soon as user/roles are present.

---

## Which admin lifecycle / permission mechanism should control visibility

- **Source of truth:** Current **admin user and roles** (from Redux: `state.admin_app.user` / `state.auth.user` and their `roles`). Permissions (e.g. `plugin::modules-sidebar.read`) control **whether** the user can open the All Modules plugin; they do not by themselves control which **main sidebar** links (Content Manager, Home, Deploy, Settings) are visible. That is done by our **role-based** rule: Super Admin → show all; HR/LM/Admin → only media-library + custom modules.
- **Lifecycle that must drive the sidebar:**
  1. **Logout:** As soon as the store loses the user/token, we must set the body flag to `pending` and clear sessionStorage so the next user never sees the previous role’s sidebar.
  2. **Login:** As soon as the store has the new user and roles, we must set the body flag from those roles (Super Admin → `false`, others → `true`).
  3. **First load (no user yet):** Body flag must be `pending` (never `false` when unknown).

So the correct hook is **Redux store subscription**: on every state change, detect “user just logged out” (user/token gone) or “user/roles present” and update the body flag and storage accordingly. The plugin’s one-time load logic must **never** set “show all” when the role is unknown.

---

## Role-safe sidebar logic (design)

1. **Single source of truth:** Current user roles from **Redux** only. Use sessionStorage/window only as a **same-session cache**; invalidate on logout or user change.
2. **Unknown or no user:** Always set `data-hide-cm-sidebar="pending"` (hide restricted items). Never set `false` when we don’t know the role.
3. **On logout (user/token cleared in Redux):** In the same synchronous block: set body flag to `pending`, clear `__is_super_admin__` and `__modules_sidebar_roles__`, clear in-memory caches. So the next paint (or next user) never sees the previous user’s “show all” state.
4. **On login (user/roles present in Redux):** Set body flag from roles (Super Admin → `false`, HR/LM/Admin → `true`), then update sessionStorage and caches for the current session.
5. **Plugin load:** If Redux has user/roles, use them immediately. If not, set `pending` and rely on the Redux subscriber to update as soon as the store is populated. Do **not** default missing storage to “show all”.
6. **Store availability:** If `window.strapi.store` is not available at plugin load, register the Redux subscriber as soon as it becomes available (e.g. short poll or deferred registration) so logout/login are always observed.

This gives deterministic, role-isolated behavior: first render after login uses the correct visibility, and role switching does not reuse or leak the previous user’s sidebar state.

---

## Code changes applied

1. **setBodyFlagBeforeRender**  
   When `__is_super_admin__` is missing (unknown), set `data-hide-cm-sidebar="pending"` instead of `"false"` so we never show the full sidebar to a restricted user.

2. **detectInitialRoles**  
   When roles are still unknown after retries, set or keep the body flag to `pending` instead of defaulting to `false`.

3. **Redux store.subscribe**  
   When the current user becomes null (logout), synchronously: set body to `pending`, clear `__is_super_admin__` and `__modules_sidebar_roles__`, clear in-memory caches, then return so the next user never sees the previous “show all” state.

4. **Deferred store subscription**  
   If `window.strapi.store` is not available at plugin load, poll until it is and then subscribe so logout/login are always observed.

5. **URL MutationObserver**  
   When the URL changes to `/auth/login` or `/logout`, set body to `pending` and clear `__is_super_admin__` in addition to existing cache clears.

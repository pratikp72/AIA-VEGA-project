# Department – Create restriction (Super Admin only)

- **REST API:** Creating departments via `POST /api/departments` is blocked by the `restrict-department-create` policy. Only the Admin panel can create departments (via Content Manager).
- **Admin panel:** To ensure only Super Admin can create Department entries:
  1. Go to **Settings** → **Administration Panel** → **Roles**.
  2. For every role **except** **Super Admin**, open the role → **Content Manager** → **Department**.
  3. Leave **Create** unchecked (and **Update** / **Delete** as needed).
  4. Only **Super Admin** should have **Create** (and optionally Update/Delete) on Department.

Department entries are created automatically when a User is created or updated (from the user’s **department** and **company**). Each combination of department name + company is unique (one Department document per pair).

### Department relation dropdown (filtered by company)

When a content type has both a **company** field and a **department** relation (e.g. Event, Holiday), the “Add relation” dropdown for the department field in the Admin panel shows only departments that belong to the **current record’s company**. This avoids duplicate-looking entries (e.g. “Electrical department” for AIA and for Vega); you only see departments for the company of the entry you’re editing. Implemented via `src/extensions/content-manager/strapi-server.js`.

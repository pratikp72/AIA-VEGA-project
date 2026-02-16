# Shared components

Reusable components you can use in any content-type schema.

---

## Yes/No Toggle (Required) – `shared.required-toggle`

A **boolean toggle** with **required** validation. Strapi admin shows it as a toggle (Yes/No) and enforces that it must be set.

### Use in any schema

Add this attribute to any content-type’s `attributes` in `schema.json`:

```json
"your_field_name": {
  "type": "component",
  "component": "shared.required-toggle",
  "required": true,
  "repeatable": false
}
```

- **Required checkbox:** Set `"required": true` to make the field mandatory, or `"required": false` to make it optional.
- **API response:** The value is nested, e.g. `your_field_name: { value: true }` or `your_field_name: { value: false }`.

### Flat boolean (no component)

If you want a **plain boolean** on the API (e.g. `your_field_name: true`) and a required toggle in the admin, add this to your schema instead:

```json
"your_field_name": {
  "type": "boolean",
  "required": true,
  "default": false
}
```

Admin will show a toggle; **Required** can be set in the Content-Type Builder (checkbox) or by keeping `"required": true` in the JSON.

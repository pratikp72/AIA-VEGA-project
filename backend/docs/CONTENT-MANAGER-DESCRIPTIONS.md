# Why Field Descriptions Don't Show in Content Manager

## Summary

The `description` property added to schema attributes in your content types **is not used by Strapi's Content Manager** to display hint text in the edit view.

## How Strapi Works

1. **Schema `description`** – The `description` property on attributes in `schema.json` is **not consumed** by the Content Manager UI. It may be used for documentation or other tooling, but Strapi v5 does not display it in the Content Manager edit view.

2. **Content Manager field descriptions** – The descriptions shown under fields in the Content Manager come from the **Edit View Configuration**, which is stored in the database (core_store), not in schema files.

## How to Add Descriptions (Manual Method)

To show descriptions in the Content Manager:

1. Open **Content Manager** in the admin panel.
2. Select a content type (e.g. Company, Course, etc.).
3. Click the **Settings** (gear) icon.
4. Click **Configure the view**.
5. In the **View** tab, you’ll see the list of fields.
6. For each field, click the **Edit** (pencil) icon.
7. In the field settings, find the **Description** field and enter your hint text.
8. Click **Save**.

Repeat for each content type and field where you want descriptions.

## Schema Descriptions

The `description` values in your schemas are still useful for:

- **Documentation** – They document what each field is for.
- **Future use** – Strapi may support schema descriptions in the Content Manager in future versions.
- **Other tools** – Type generators, API docs, or custom plugins can read them.

## References

- [Content Manager – Configuring the edit view](https://docs.strapi.io/cms/features/content-manager#edit-view-settings)
- [Strapi Models documentation](https://docs.strapi.io/cms/backend-customization/models)

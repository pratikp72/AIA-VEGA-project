const fs = require('fs');
const path = require('path');

const root = path.join(process.cwd(), 'src', 'api');
if (!fs.existsSync(root)) {
  console.error('No src/api found at', root);
  process.exit(1);
}

const apis = fs.readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const out = [];

for (const apiName of apis) {
  const ctRoot = path.join(root, apiName, 'content-types');
  if (!fs.existsSync(ctRoot)) continue;

  const cts = fs.readdirSync(ctRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const ctDir of cts) {
    const schemaPath = path.join(ctRoot, ctDir, 'schema.json');
    if (!fs.existsSync(schemaPath)) continue;

    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    if (schema.kind !== 'collectionType') continue;

    const singular = schema?.info?.singularName || ctDir;
    const uid = `api::${singular}.${singular}`;
    const display = schema?.info?.displayName || singular;

    out.push({ display, uid, route: `/admin/content-manager/collection-types/${uid}` });
  }
}

out.sort((a, b) => a.display.localeCompare(b.display));

for (const item of out) {
  console.log(`${item.display} -> ${item.route}`);
}

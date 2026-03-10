require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT,
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  await client.connect();

  const col = await client.query(
    "select data_type, udt_name from information_schema.columns where table_schema='public' and table_name='unit_locations' and column_name='note'"
  );
  const info = col.rows[0];
  if (!info) {
    console.log('unit_locations.note not found; skipping');
    await client.end();
    return;
  }

  const isJson = info.data_type === 'json' || info.data_type === 'jsonb' || info.udt_name === 'json' || info.udt_name === 'jsonb';
  console.log('column_type:', info);
  if (isJson) {
    console.log('note column already json/jsonb; no pre-fix needed');
    await client.end();
    return;
  }

  const res1 = await client.query("UPDATE public.unit_locations SET note = NULL WHERE note IS NOT NULL AND btrim(note) = ''");
  const res2 = await client.query("UPDATE public.unit_locations SET note = '[]' WHERE note IS NOT NULL");

  console.log('blank_to_null:', res1.rowCount);
  console.log('coerced_to_array:', res2.rowCount);

  await client.query("CREATE OR REPLACE FUNCTION public._safe_parse_jsonb(input_text text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$ BEGIN RETURN input_text::jsonb; EXCEPTION WHEN others THEN RETURN NULL; END; $$;");
  const invalid = await client.query("select count(*)::int as c from public.unit_locations where note is not null and btrim(note) <> '' and public._safe_parse_jsonb(note) is null");
  console.log('invalid_after_fix:', invalid.rows[0]?.c ?? 0);
  await client.query("DROP FUNCTION IF EXISTS public._safe_parse_jsonb(text);");

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

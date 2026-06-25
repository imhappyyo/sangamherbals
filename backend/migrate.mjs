// migrate.mjs — load data/catalog.json into Supabase (idempotent).
//
// Reads ../data/catalog.json and upserts every category, every product, and the
// fx_rub_eur setting into Supabase using a service-role client (bypasses RLS).
// Safe to re-run: categories conflict on `uid`, products on `id`, settings on `key`.
//
// Required env (see .env.example):
//   SUPABASE_URL                — your project URL
//   SUPABASE_SERVICE_ROLE_KEY   — service_role key (SECRET, server-side only)
//
// Usage: npm run migrate   (from the backend/ directory)

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = resolve(__dirname, '../data/catalog.json');
const CHUNK_SIZE = 100;

function die(msg, err) {
  console.error(`\n✗ ${msg}`);
  if (err) console.error(err.message || err);
  process.exit(1);
}

// ---- env ----------------------------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  die(
    'Missing env. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
      '(copy .env.example to .env and fill it in).'
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---- helpers ------------------------------------------------------------
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function upsertInChunks(table, rows, onConflict, label) {
  if (rows.length === 0) {
    console.log(`  ${label}: nothing to upsert`);
    return 0;
  }
  const batches = chunk(rows, CHUNK_SIZE);
  let done = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict, ignoreDuplicates: false });
    if (error) {
      throw new Error(
        `${label} batch ${i + 1}/${batches.length} failed: ${error.message}`
      );
    }
    done += batch.length;
    console.log(
      `  ${label}: batch ${i + 1}/${batches.length} ` +
        `(${done}/${rows.length})`
    );
  }
  return done;
}

// ---- field mapping (catalog -> contract columns) ------------------------
function mapCategory(cat) {
  return {
    uid: cat.uid,
    title: cat.title ?? null,
    title_en: cat.title_en ?? null,
    section: cat.section ?? null,
    section_slug: cat.section_slug ?? null,
    slug: cat.slug ?? null,
    is_section: cat.is_section ?? false,
  };
}

function mapProduct(prod, index) {
  return {
    id: prod.id,
    sku: prod.sku ?? null,
    title_en: prod.title_en ?? null,
    title_ru: prod.title_ru ?? null,
    blurb_en: prod.blurb_en ?? null,
    desc_ru: prod.desc_ru ?? null,
    price_eur: prod.price_eur ?? null,
    price_rub: prod.price_rub ?? null,
    section: prod.section ?? null,
    section_en: prod.section_en ?? null,
    section_slug: prod.section_slug ?? null,
    category_uids: prod.category_uids ?? [],
    category_names: prod.category_names ?? [],
    category_en: prod.category_en ?? [],
    image: prod.image ?? null,
    images: prod.images ?? [],
    concerns: prod.concerns ?? [],
    concern_primary: prod.concern_primary ?? null,
    pdp: prod.pdp ?? null,
    url_ru: prod.url_ru ?? null,
    active: true,
    sort_order: index,
  };
}

// ---- main ---------------------------------------------------------------
async function main() {
  console.log('Sangam Herbals — catalog → Supabase migration');
  console.log(`Catalog: ${CATALOG_PATH}`);
  console.log(`Target:  ${SUPABASE_URL}\n`);

  let catalog;
  try {
    catalog = JSON.parse(await readFile(CATALOG_PATH, 'utf8'));
  } catch (err) {
    die(`Could not read/parse catalog.json at ${CATALOG_PATH}`, err);
  }

  const categories = Array.isArray(catalog.categories) ? catalog.categories : [];
  const products = Array.isArray(catalog.products) ? catalog.products : [];
  const fxRubEur = catalog.fx_rub_eur;

  console.log(
    `Loaded: ${categories.length} categories, ${products.length} products, ` +
      `fx_rub_eur=${fxRubEur}\n`
  );

  // 1) categories (conflict on uid)
  console.log('Upserting categories…');
  const catRows = categories.map(mapCategory).filter((c) => c.uid != null);
  const catCount = await upsertInChunks(
    'categories',
    catRows,
    'uid',
    'categories'
  );

  // 2) products (conflict on id), sort_order = original index
  console.log('Upserting products…');
  const prodRows = products
    .map((p, i) => mapProduct(p, i))
    .filter((p) => p.id != null);
  const prodCount = await upsertInChunks(
    'products',
    prodRows,
    'id',
    'products'
  );

  // 3) settings: fx_rub_eur (conflict on key)
  console.log('Upserting settings…');
  let settingsCount = 0;
  if (fxRubEur != null) {
    const { error } = await supabase
      .from('settings')
      .upsert(
        [{ key: 'fx_rub_eur', value: fxRubEur }],
        { onConflict: 'key', ignoreDuplicates: false }
      );
    if (error) throw new Error(`settings upsert failed: ${error.message}`);
    settingsCount = 1;
    console.log('  settings: fx_rub_eur upserted');
  } else {
    console.log('  settings: fx_rub_eur missing from catalog, skipped');
  }

  console.log('\n✓ Migration complete');
  console.log(
    `  categories: ${catCount}\n` +
      `  products:   ${prodCount}\n` +
      `  settings:   ${settingsCount}`
  );
}

main().catch((err) => die('Migration failed', err));

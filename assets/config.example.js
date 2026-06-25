/*
 * Sangam Herbals — EXAMPLE runtime config.
 *
 * Copy this file to assets/config.js and replace the placeholder values with
 * your real Supabase project credentials. Do not commit secrets — only the
 * PUBLIC "anon" key belongs in this file (it is safe to expose; the database
 * is protected by Row Level Security, which makes it read-only for the public
 * storefront).
 *
 * Where to find these values:
 *   Supabase → Project Settings → API
 *     - supabaseUrl     → "Project URL"
 *     - supabaseAnonKey → "Project API keys" → "anon" (public) key
 *
 * NEVER put the "service_role" / secret key in any client-side file. That key
 * bypasses RLS and must only be used server-side by the migration script
 * (read from an environment variable, e.g. SUPABASE_SERVICE_ROLE_KEY).
 *
 * If you leave both values empty, the storefront falls back to data/catalog.json.
 */
window.SH_CONFIG = {
  // Example only — replace with your own project URL:
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  // Example only — replace with your own public anon key (a long JWT string):
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.PLACEHOLDER_ANON_KEY.xxxxxxxxxxxxx"
};

// ============================================================================
// Refresh VAT rates — fetches current EU VAT rates from VATcomply
// (https://api.vatcomply.com/vat_rates — backed by the European Commission's
// own TEDB/Taxes-in-Europe database, no API key required) and upserts into
// public.vat_rates. The wholesale invoice flow reads from that table instead
// of a human typing a percentage in — see supabase/wholesale-vat-rates.sql
// for the table, RLS, and the pg_cron schedule that calls this on a timer.
//
// Deploy: supabase functions deploy refresh-vat-rates
// Can also just be hit manually (GET or POST) to refresh on demand.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const res = await fetch("https://api.vatcomply.com/vat_rates");
    if (!res.ok) return json({ error: `VATcomply returned HTTP ${res.status}` }, 502);
    const data = await res.json();

    // Defensive: handle either a bare array or an object keyed by country —
    // don't assume the exact wrapper shape holds forever on someone else's API.
    const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.rates) ? data.rates : Object.values(data || {});

    const rows = list
      .map((r: any) => ({
        country_code: r.country_code,
        country_name: r.country_name,
        standard_rate: r.standard_rate,
        reduced_rates: r.reduced_rates || [],
        fetched_at: new Date().toISOString(),
      }))
      .filter((r) => r.country_code && typeof r.standard_rate === "number");

    if (!rows.length) return json({ error: "No usable rate rows found in VATcomply response — shape may have changed" }, 502);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await admin.from("vat_rates").upsert(rows, { onConflict: "country_code" });
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, count: rows.length, fetched_at: new Date().toISOString() });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

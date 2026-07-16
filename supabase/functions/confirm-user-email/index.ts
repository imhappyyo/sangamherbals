// ============================================================================
// Confirm user email — admin-only manual override for a wholesale customer
// whose confirmation email never arrived or was never clicked. Equivalent to
// `update auth.users set email_confirmed_at = now() where id = ...`, which
// can't be run from a browser: auth.users is only writable via the Supabase
// Admin API (auth.admin.updateUserById), which requires the service-role
// key — a secret that must never reach client-side code. This function holds
// that key server-side and only acts after verifying the CALLER is an admin
// (checked against public.admins, same allow-list every RLS policy uses).
//
// Deploy:  supabase functions deploy confirm-user-email
// Called from sangam-work's Wholesale tab with { user_id }.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Inlined rather than imported from ../_shared/price.ts — the dashboard's
// single-file function editor can't resolve relative imports outside a
// function's own directory, and this keeps deployment method-agnostic
// (works via dashboard paste OR `supabase functions deploy`).
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "missing authorization" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Identify the caller from their own JWT (anon-key-scoped client, so this
    // step alone grants no elevated privilege — it only tells us who's asking).
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: { user }, error: userErr } = await caller.auth.getUser();
    if (userErr || !user?.email) return json({ error: "invalid session" }, 401);

    const admin = createClient(url, serviceKey);

    // The only gate before anything privileged happens: caller's email must
    // be in public.admins. Everything after this line bypasses RLS entirely
    // (service-role client), so this check IS the security boundary.
    const { data: isAdminRow } = await admin.from("admins").select("email").eq("email", user.email).maybeSingle();
    if (!isAdminRow) return json({ error: "admin only" }, 403);

    const { user_id } = await req.json();
    if (!user_id) return json({ error: "missing user_id" }, 400);

    const { error: updateErr } = await admin.auth.admin.updateUserById(user_id, { email_confirm: true });
    if (updateErr) return json({ error: updateErr.message }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

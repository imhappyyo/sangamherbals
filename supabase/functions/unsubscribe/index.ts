// ============================================================================
// Unsubscribe — PUBLIC, no auth. A recipient clicking the link in a
// marketing email may not be logged into anything, so this deliberately
// takes NO Authorization header and is gated only by knowing the opaque
// unsubscribe_token from their own email (see wholesale-email-command-
// centre.sql — token is a separate random uuid, not the customer's id).
//
// Deploy:  supabase functions deploy unsubscribe --no-verify-jwt
// (The --no-verify-jwt flag matters: without it, Supabase's platform-level
// JWT check would 401 every request before this code even runs, since
// there's no Authorization header to verify.)
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function page(title: string, message: string) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#f6f4ee;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
  .card{background:#fff;border:1px solid #e4e0d6;border-radius:10px;padding:32px 40px;max-width:420px;text-align:center}
  h1{font-size:18px;margin:0 0 8px;color:#2b2a22}
  p{color:#5b5748;font-size:14px;line-height:1.5;margin:0}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}
const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const token = new URL(req.url).searchParams.get("token");
  if (!token) {
    return html(page("Invalid link", "This unsubscribe link is missing its token."), 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await admin
    .from("wholesale_customers")
    .update({
      marketing_opt_out: true,
      marketing_opt_out_at: new Date().toISOString(),
      marketing_opt_out_method: "unsubscribe_link",
    })
    .eq("unsubscribe_token", token)
    .select("company_name")
    .maybeSingle();

  if (error || !data) {
    return html(page(
      "Link not recognized",
      "We couldn't find a matching subscription for this link. If you keep receiving unwanted email, reply to let us know.",
    ), 404);
  }

  return html(page(
    "You're unsubscribed",
    `${data.company_name}, you won't receive further marketing emails from Sangam Herbals. Order confirmations and shipping notices are unaffected.`,
  ));
});

// ============================================================================
// Send marketing email — admin-only, broadcast to a filtered set of approved
// wholesale customers.
//
// No self-service unsubscribe link is sent (deliberate business decision —
// see chat history). marketing_opt_out is still checked and still skips a
// send when true, but that flag is only ever set by an admin manually
// (e.g. a customer calls or emails asking to stop) — there is no
// customer-facing way to trigger it. supabase/functions/unsubscribe still
// exists and still works if a link to it is ever added back later, but
// nothing currently links to it.
//
// The customerIds the client sends are a UI convenience only — this
// function re-queries wholesale_customers itself and re-checks
// status/opt-out server-side before sending anything, so a stale id list
// (opted out between opening the composer and hitting send) can't slip a
// send through. See supabase/wholesale-email-command-centre.sql.
//
// Deploy:  supabase functions deploy send-marketing-email
// Requires the BREVO_API_KEY secret (same as send-lr-email).
// Called from sangam-work's Wholesale → Email sub-tab with
// { customerIds: string[], subject, bodyHtml }.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SENDER = { name: "Sangam Herbals", email: "orders@sangamherbals.com" };

async function sendViaBrevo(payload: Record<string, unknown>) {
  // Fail loud and specific here rather than letting fetch() throw a generic
  // "invalid header value" error when the key is missing — that generic
  // error also never reaches Brevo's own servers at all, so it wouldn't
  // show up in Brevo's dashboard logs either, making it look like nothing
  // happened. This check turns that into an unambiguous message instead.
  const apiKey = Deno.env.get("BREVO_API_KEY");
  if (!apiKey) throw new Error("BREVO_API_KEY secret is missing or empty in this function's environment — set it under Edge Functions → Secrets.");

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Brevo returned HTTP ${res.status}`);
  return data as { messageId?: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "missing authorization" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: { user }, error: userErr } = await caller.auth.getUser();
    if (userErr || !user?.email) return json({ error: "invalid session" }, 401);

    const admin = createClient(url, serviceKey);

    const { data: isAdminRow } = await admin.from("admins").select("email").eq("email", user.email).maybeSingle();
    if (!isAdminRow) return json({ error: "admin only" }, 403);

    const { customerIds, subject, bodyHtml } = await req.json();
    if (!Array.isArray(customerIds) || !customerIds.length || !subject || !bodyHtml) {
      return json({ error: "missing customerIds, subject, or bodyHtml" }, 400);
    }

    const { data: customers, error: custErr } = await admin
      .from("wholesale_customers")
      .select("id, email, company_name, status, marketing_opt_out")
      .in("id", customerIds);
    if (custErr) return json({ error: custErr.message }, 500);

    let sent = 0, failed = 0, skippedOptOut = 0;

    for (const c of customers || []) {
      if (c.status !== "approved" || c.marketing_opt_out) {
        skippedOptOut++;
        await admin.from("email_log").insert({
          customer_id: c.id, recipient_email: c.email, email_type: "marketing",
          subject, status: "skipped_optout", sent_by: user.id,
        });
        continue;
      }

      let status = "sent";
      let errorMessage: string | null = null;
      let messageId: string | undefined;
      try {
        const result = await sendViaBrevo({
          sender: SENDER,
          to: [{ email: c.email, name: c.company_name }],
          subject,
          htmlContent: bodyHtml,
        });
        messageId = result.messageId;
        sent++;
      } catch (e) {
        status = "failed";
        errorMessage = String((e as Error)?.message || e);
        failed++;
      }

      await admin.from("email_log").insert({
        customer_id: c.id, recipient_email: c.email, email_type: "marketing",
        subject, status, provider_message_id: messageId || null, error_message: errorMessage, sent_by: user.id,
      });
    }

    return json({ ok: true, sent, failed, skippedOptOut });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

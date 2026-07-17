// ============================================================================
// Send marketing email — admin-only, broadcast to a filtered set of approved
// wholesale customers. Unlike send-lr-email, this is genuinely "marketing"
// under the ePrivacy Directive's existing-customer soft opt-in — so every
// send here is gated on marketing_opt_out and gets an unsubscribe footer.
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
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": Deno.env.get("BREVO_API_KEY")!,
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
      .select("id, email, company_name, status, marketing_opt_out, unsubscribe_token")
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

      const unsubLink = `${url}/functions/v1/unsubscribe?token=${c.unsubscribe_token}`;
      const html = `${bodyHtml}<hr style="margin:24px 0;border:none;border-top:1px solid #ddd"/>` +
        `<p style="font-size:11px;color:#888">Sangam Herbals — you're receiving this as an existing wholesale customer. ` +
        `<a href="${unsubLink}">Unsubscribe from marketing emails</a></p>`;

      let status = "sent";
      let errorMessage: string | null = null;
      let messageId: string | undefined;
      try {
        const result = await sendViaBrevo({
          sender: SENDER,
          to: [{ email: c.email, name: c.company_name }],
          subject,
          htmlContent: html,
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

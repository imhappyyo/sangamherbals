// ============================================================================
// Send LR email — admin-only. Emails a single PDF attachment (a Lorry
// Receipt / dispatch-proof document) to the ONE customer on a given order.
// Purely transactional: no marketing-opt-out check applies here (GDPR
// Art. 6(1)(b) — necessary for fulfilling that customer's own order), unlike
// send-marketing-email which gates on it. See supabase/wholesale-email-
// command-centre.sql for the schema/reasoning this depends on.
//
// Deploy:  supabase functions deploy send-lr-email
// Requires the BREVO_API_KEY secret (Project Settings → Edge Functions →
// Secrets, or `supabase secrets set BREVO_API_KEY=...`).
// Called from sangam-work's Wholesale → Orders sub-tab with
// { orderId, subject, bodyText, attachment: { filename, contentBase64 } }.
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

    const { orderId, subject, bodyText, attachment } = await req.json();
    if (!orderId || !subject || !bodyText || !attachment?.filename || !attachment?.contentBase64) {
      return json({ error: "missing orderId, subject, bodyText, or attachment" }, 400);
    }

    const { data: order, error: orderErr } = await admin
      .from("wholesale_orders")
      .select("id, customer_id, wholesale_customers(email, company_name)")
      .eq("id", orderId)
      .single();
    const customer = order?.wholesale_customers as { email?: string; company_name?: string } | null;
    if (orderErr || !customer?.email) return json({ error: "order or customer email not found" }, 404);

    let messageId: string | undefined;
    let status = "sent";
    let errorMessage: string | null = null;
    try {
      const result = await sendViaBrevo({
        sender: SENDER,
        to: [{ email: customer.email, name: customer.company_name }],
        subject,
        textContent: bodyText,
        attachment: [{ name: attachment.filename, content: attachment.contentBase64 }],
      });
      messageId = result.messageId;
    } catch (e) {
      status = "failed";
      errorMessage = String((e as Error)?.message || e);
    }

    await admin.from("email_log").insert({
      customer_id: order!.customer_id,
      recipient_email: customer.email,
      email_type: "lr_copy",
      subject,
      related_order_id: order!.id,
      status,
      provider_message_id: messageId || null,
      error_message: errorMessage,
      sent_by: user.id,
    });

    if (status === "failed") return json({ error: errorMessage }, 502);
    return json({ ok: true, messageId });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

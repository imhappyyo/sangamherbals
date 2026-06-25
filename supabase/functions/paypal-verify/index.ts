// ============================================================================
// PayPal verify — confirms a PayPal capture server-side and marks the order paid.
// The browser captures via the PayPal SDK, then sends { order_id, paypal_order_id }.
// We re-fetch the capture from PayPal's API and compare the captured amount to the
// server-recomputed total, so the charged amount can't be tampered with.
//
// Deploy:  supabase functions deploy paypal-verify
// Secrets: supabase secrets set PAYPAL_CLIENT_ID=... PAYPAL_SECRET=... PAYPAL_ENV=live
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recompute, CORS, json } from "../_shared/price.ts";

const PP = Deno.env.get("PAYPAL_ENV") === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { order_id, paypal_order_id } = await req.json();
    if (!order_id || !paypal_order_id) return json({ error: "missing fields" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: order } = await admin.from("orders").select("*").eq("id", order_id).single();
    if (!order) return json({ error: "order not found" }, 404);

    // PayPal access token
    const auth = btoa(`${Deno.env.get("PAYPAL_CLIENT_ID")}:${Deno.env.get("PAYPAL_SECRET")}`);
    const tok = await (await fetch(`${PP}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    })).json();

    // re-fetch the captured PayPal order
    const ppo = await (await fetch(`${PP}/v2/checkout/orders/${paypal_order_id}`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    })).json();
    const paid = Number(ppo?.purchase_units?.[0]?.amount?.value || 0);
    const completed = ppo?.status === "COMPLETED";

    const { total } = await recompute(admin, order.items);
    if (completed && Math.abs(paid - total) < 0.01) {
      await admin.from("orders").update({
        status: "paid", payment_method: "paypal", payment_ref: paypal_order_id, amount_verified_eur: total,
      }).eq("id", order_id);
      return json({ ok: true });
    }
    return json({ ok: false, reason: "status/amount mismatch", paid, total }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

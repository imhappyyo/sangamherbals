// ============================================================================
// Stripe Checkout — creates a hosted payment session for an order.
// The browser sends ONLY { order_id }. We reload the order with the service-role
// key and recompute every price from the products table, so a tampered cart
// can never change what is charged. Secret key lives only in this function's env.
//
// Deploy:  supabase functions deploy create-checkout-session
// Secrets: supabase secrets set STRIPE_SECRET_KEY=sk_live_... SITE_URL=https://sangamherbals.com
//          (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are provided automatically)
// ============================================================================
import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recompute, CORS, json } from "../_shared/price.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { order_id } = await req.json();
    if (!order_id) return json({ error: "missing order_id" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: order, error } = await admin.from("orders").select("*").eq("id", order_id).single();
    if (error || !order) return json({ error: "order not found" }, 404);
    if (order.status !== "pending") return json({ error: "order not payable" }, 409);

    const { lines, total } = await recompute(admin, order.items);
    if (!lines.length) return json({ error: "no valid items" }, 400);

    // record the server-verified amount before redirecting to payment
    await admin.from("orders").update({ amount_verified_eur: total, payment_method: "stripe" }).eq("id", order_id);

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
    const site = (Deno.env.get("SITE_URL") || "https://sangamherbals.com").replace(/\/$/, "");
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: order.email || undefined,
      line_items: lines.map((l) => ({
        quantity: l.qty,
        price_data: { currency: "eur", unit_amount: l.unit_amount, product_data: { name: l.name } },
      })),
      metadata: { order_id },
      success_url: `${site}/?checkout=success&order=${order_id}`,
      cancel_url: `${site}/?checkout=cancel&order=${order_id}`,
    });
    return json({ url: session.url });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

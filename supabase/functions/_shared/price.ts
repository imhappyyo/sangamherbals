// ============================================================================
// Server-side price recompute — the ONLY source of truth for charged amounts.
// Never trust amounts sent by the browser. Prices come straight from the DB.
// ============================================================================
export const FREE_SHIP = 35;   // EUR — free shipping at/above this subtotal
export const SHIP_FLAT = 4.90; // EUR — flat shipping below the threshold

export async function recompute(admin: any, items: any[]) {
  const ids = (items || []).map((i) => i.id);
  const { data: prods } = await admin
    .from("products")
    .select("id,title_en,title_ru,price_eur")
    .in("id", ids);
  const byId = new Map((prods || []).map((p: any) => [String(p.id), p]));

  const lines: { name: string; unit_amount: number; qty: number }[] = [];
  let subtotal = 0;
  for (const it of items || []) {
    const p = byId.get(String(it.id));
    if (!p || p.price_eur == null) continue;
    const qty = Math.min(99, Math.max(1, parseInt(it.qty) || 1)); // clamp 1..99
    const amt = Number(p.price_eur);
    subtotal += amt * qty;
    lines.push({ name: (p.title_en || p.title_ru || "Item").slice(0, 120), unit_amount: Math.round(amt * 100), qty });
  }
  const shipping = subtotal >= FREE_SHIP ? 0 : SHIP_FLAT;
  return { lines, subtotal: +subtotal.toFixed(2), shipping, total: +(subtotal + shipping).toFixed(2) };
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

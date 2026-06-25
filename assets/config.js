/*
 * Sangam Herbals — storefront/admin runtime config.
 *
 * Supabase (optional): paste your Project URL and the PUBLIC "anon" key. The anon key
 * is SAFE to expose; the database is protected by Row Level Security. NEVER paste the
 * "service_role" / secret key here. When both are empty, the storefront falls back to
 * the bundled data/catalog.json so the site keeps working with no backend.
 *
 * Checkout works out of the box via WhatsApp / email (no payment keys needed). Card
 * payment (Stripe / PayPal) stays OFF until you paste your own PUBLIC keys below.
 */
window.SH_CONFIG = {
  // --- Supabase backend (optional) ---
  supabaseUrl: "https://qmiexuoqhttwjzpagcsr.supabase.co",
  supabaseAnonKey: "sb_publishable_9MPZFDeF62TdDxTlO51maw_zbQ7sZ5j",

  // --- Checkout: where orders are sent (works immediately, no payment keys) ---
  whatsapp: "919910602959",                 // digits only, incl. country code (no +, spaces or dashes)
  orderEmail: "sangamherbals@gmail.com",
  businessName: "Sangam Herbals",

  // --- Card payments (leave empty until you connect your OWN accounts) ---
  // Stripe: paste your PUBLISHABLE key (pk_live_… / pk_test_…). Your SECRET key must
  //   NEVER live here — it belongs only in a Supabase Edge Function. Set stripeCheckoutUrl
  //   to your deployed "create-checkout-session" function URL to switch card checkout on.
  stripePublishableKey: "",
  stripeCheckoutUrl: "",
  // PayPal: paste your REST app Client ID to switch PayPal buttons on.
  paypalClientId: "",
  // Optional: your deployed "paypal-verify" Edge Function URL (server-side capture check).
  paypalVerifyUrl: ""
};

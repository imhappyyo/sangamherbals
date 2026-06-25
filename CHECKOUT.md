# Checkout & Backend — setup runbook

The store **already takes orders today** via WhatsApp / email (no setup needed). Card
payment (Stripe / PayPal) and the admin Orders panel switch on once you connect your own
accounts. Nothing here exposes a secret key in the website.

---

## 0. Backend admin — URL & login

**URL:** `/admin.html`
- Local preview: <http://localhost:4699/admin.html>
- Live (after deploy): <https://sangamherbals.com/admin.html>

**Login email:** `sangamherbals@gmail.com` — already added to the admin allow-list in
`supabase/schema.sql`. Only this email can manage products/orders.

**Password:** *you* set it (I can't create it — it lives in your own Supabase project, see
step 1.4). Until you do the ~10-minute Supabase setup below, `/admin.html` shows a
"backend not configured" screen — that's expected.

---

## 1. Supabase (free) — products, orders, admin login  (~10 min)

1.1  Create a project at <https://supabase.com> → **New project** (pick a strong DB password, keep it).

1.2  **SQL Editor → New query →** paste all of `supabase/schema.sql` → **Run**.
     This creates the products / categories / settings / **orders** tables, the security
     rules (RLS), and adds `sangamherbals@gmail.com` to the admin allow-list.

1.3  **Project Settings → API:** copy the **Project URL** and the **anon public** key, and
     paste them into `assets/config.js` (`supabaseUrl`, `supabaseAnonKey`).
     *Never* paste the `service_role` / secret key here.

1.4  **Authentication → Users → Add user →** email `sangamherbals@gmail.com`, set a password,
     **Auto-confirm**. (Then **Authentication → Providers → Email →** turn **Sign-ups OFF**
     so strangers can't self-register.) — That email + password is your `/admin.html` login.

1.5  *(optional, to manage products in the admin too)* run the product migration:
     `cd backend && npm install && cp .env.example .env` → fill `SUPABASE_URL` +
     `SUPABASE_SERVICE_ROLE_KEY` → `npm run migrate`.

Now log in at `/admin.html`. Orders placed on the site appear under the **Orders** tab.

---

## 2. Stripe — card payment  (when you're ready)

2.1  Create a Stripe account → **Developers → API keys**: copy the **Secret key** (`sk_…`)
     and **Publishable key** (`pk_…`).

2.2  Deploy the Edge Function (it holds the secret key server-side and **re-checks every
     price from the database**, so a tampered cart can't change the amount):
```
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook --no-verify-jwt
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx SITE_URL=https://sangamherbals.com
```

2.3  In `assets/config.js` set:
```
stripePublishableKey: "pk_live_xxx",
stripeCheckoutUrl: "https://<your-project>.functions.supabase.co/create-checkout-session"
```

2.4  **Stripe → Developers → Webhooks → Add endpoint:** the `stripe-webhook` function URL,
     event `checkout.session.completed`. Copy its signing secret and run:
     `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxx`

The **Pay by card** button now appears at checkout and redirects to Stripe.

---

## 3. PayPal — optional

3.1  Create a PayPal REST app → copy **Client ID** + **Secret**.

3.2  Deploy the verify function (re-checks the captured amount server-side):
```
supabase functions deploy paypal-verify
supabase secrets set PAYPAL_CLIENT_ID=xxx PAYPAL_SECRET=xxx PAYPAL_ENV=live
```

3.3  In `assets/config.js` set:
```
paypalClientId: "xxx",
paypalVerifyUrl: "https://<your-project>.functions.supabase.co/paypal-verify"
```

PayPal buttons now appear at checkout.

---

## Security notes
- Secret keys live **only** in Supabase Edge Function secrets — never in the website.
- Edge Functions recompute prices from the `products` table and ignore client amounts
  (price-tampering can't change what's charged).
- The public site can only **insert** a clean `pending` order (RLS); it cannot read other
  orders, set a "paid" status, or set the verified amount. Only `sangamherbals@gmail.com`
  (admin) can read/manage orders.
- Stripe payment is confirmed by a signature-verified webhook; PayPal by a server-side
  capture check.

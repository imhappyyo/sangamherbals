# Security — Sangam Herbals

A practical checklist of how this site is protected and the few things **you** must do
before and after going live. None of these require touching code.

---

## The security model in one paragraph
The storefront is static files (no server to hack). Product data lives in Supabase, protected
by **Row-Level Security (RLS)**: the public can only *read*; only **admin emails you name** can
add/edit/remove products. The public "anon" key in `assets/config.js` is safe to expose; the
secret `service_role` key is never in the website and is git-ignored. A **Content-Security-Policy**
blocks injected scripts, and all product text is HTML-escaped to prevent XSS. No card/payment
data is ever handled by this site.

---

## ✅ Before you go live — required steps

1. **Lock writing to YOUR admin email.** `supabase/schema.sql` now creates an `admins` allow-list
   and only those emails can modify products. After running the schema, add yourself (SQL editor):
   ```sql
   insert into public.admins (email) values ('you@example.com') on conflict do nothing;
   ```
   Anyone *not* on this list — even a logged-in stranger — cannot write. This is the single most
   important control.

2. **Disable public sign-ups in Supabase.** Dashboard → **Authentication → Sign In / Providers**
   → turn off "Allow new users to sign up" (or set email confirmations + invite-only). Otherwise a
   stranger could self-register an account. (Combined with step 1 they still couldn't write, but
   closing sign-ups removes the risk entirely.)

3. **Create your admin user** (Authentication → Users → Add user) with a **strong, unique password**,
   and **enable MFA** (Authentication → MFA). Log in at `/admin.html`.

4. **Protect the `service_role` key.** It bypasses every protection. It belongs only in
   `backend/.env` (already git-ignored). Never paste it into a screenshot, chat, commit, or
   `config.js`. If it ever leaks, rotate it immediately in Supabase → Settings → API.

---

## 🌐 Hosting & HTTPS

- **Deploy to Cloudflare Pages or Netlify.** Both read the included **`_headers`** file, which applies
  the full security header set: Content-Security-Policy, **HSTS** (forces HTTPS), `X-Frame-Options`
  (anti-clickjacking), `nosniff`, `Referrer-Policy`, and a locked-down `Permissions-Policy`.
- **GitHub Pages does NOT support custom headers.** If you must use it, put **Cloudflare in front**
  of it (free) to apply the headers, or accept the weaker baseline: the pages also carry a
  `<meta>` CSP that works anywhere, but `<meta>` can't set HSTS or frame-ancestors.
- **Always enforce HTTPS** at the host (Cloudflare/Netlify do this automatically).

---

## 🔒 What's already protected (no action needed)

- **Database:** RLS — public read-only, admin-only writes (per step 1). Storage bucket: public image
  read, admin-only upload.
- **Keys:** anon key is public/safe; `service_role` is secret + git-ignored.
- **XSS:** strict CSP (no inline scripts — all handlers are external), and every product field is
  escaped before rendering. The one legacy HTML field is rendered as plain text.
- **No financial risk surface:** no payment processing, no card data, no PCI scope. (When you add a
  payment provider later, it handles card data on its own servers — never this site.)
- **Privacy:** the site sets no tracking cookies; language/region/cart live only in the browser.

---

## 🔁 Ongoing
- Review the `public.admins` list periodically; remove anyone who shouldn't have access.
- `supabase-js` is loaded from a version-pinned CDN (`@2`). Keep it current.
- After connecting Supabase, do a quick test: log in, edit a product (should work), then confirm a
  logged-out browser cannot write (it can't — RLS).

> No website is ever "100% unhackable." This setup follows current best practices; the residual
> risks above are operational (your admin password, the secret key, closing sign-ups), not code flaws.

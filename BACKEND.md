# Backend Setup Runbook — Sangam Herbals

This guide walks you through standing up the **Supabase** backend for the Sangam
Herbals site. You do **not** need to be a developer. Follow the steps in order,
top to bottom, and copy-paste the commands exactly as shown.

When you finish, you'll be able to add and edit products in a branded admin panel
at `/admin.html`, and the storefront will show your changes automatically.

> **The short version of how it works:** Supabase is a free hosted database. We
> load your products into it once (the "migration"), the storefront reads from it,
> and you manage everything from the admin page. If Supabase is ever unreachable —
> or before you've configured it — the site quietly falls back to the bundled
> `data/catalog.json`, so it never goes blank.

Set aside about **20–30 minutes**. Take it one numbered step at a time.

---

## What you'll end up with

- A free Supabase project holding your products, categories, and settings.
- The storefront (`index.html`) reading live from Supabase.
- A branded admin panel (`admin.html`) where you log in and edit products.
- A safe public setup: the key in the website is read-only; the powerful key
  stays on your computer only.

---

## Step 1 — Create a free Supabase project

1. Go to **https://supabase.com** and click **Start your project** (or **Sign in**).
2. Sign up — using **GitHub** or an email address is easiest.
3. Once you're in the dashboard, click **New project**.
4. Fill in:
   - **Name:** `sangam-herbals` (anything you like).
   - **Database Password:** click **Generate a password**, then **copy it and
     save it somewhere safe** (a password manager, or a note you trust). You
     rarely need it, but you cannot recover it later.
   - **Region:** pick the one closest to your customers, e.g. **Central EU
     (Frankfurt)** or **West EU (Ireland)**.
   - **Pricing Plan:** **Free**. The free tier is plenty for this site.
5. Click **Create new project**.

Supabase takes **1–2 minutes** to set up. Wait until the project dashboard
finishes loading before continuing.

---

## Step 2 — Find your Project URL and your two keys

You need three values from Supabase. Get them all now and keep them handy
(a scratch note is fine — we'll tell you when each one is safe to publish).

In your project dashboard, click the **gear icon (Project Settings)** in the
left sidebar, then open **API**. You'll see:

| What | Where it is | Looks like | Where it goes |
| --- | --- | --- | --- |
| **Project URL** | "Project URL" box | `https://abcdefgh.supabase.co` | Public — into `assets/config.js` |
| **anon public key** | "Project API keys" → `anon` `public` | long string starting `eyJ...` | Public — into `assets/config.js` |
| **service_role key** | "Project API keys" → `service_role` `secret` | long string starting `eyJ...` | **SECRET** — only into `backend/.env` |

> The **anon** key and the **service_role** key look almost identical (both are
> long `eyJ...` strings). **They are NOT interchangeable.** Read the small grey
> label under each one — `anon` `public` vs `service_role` `secret` — and copy
> the right one each time. The `service_role` key can do anything to your data,
> so treat it like a master password. See the **Security** section at the bottom.

You may need to click **Reveal** to see the `service_role` key.

---

## Step 3 — Create the database tables (run the schema)

This creates the `products`, `categories`, and `settings` tables, the security
rules, and the storage bucket for images. You only do this once.

1. In the Supabase sidebar, click **SQL Editor**.
2. Click **New query**.
3. On your computer, open the file **`supabase/schema.sql`** from this project,
   select **all** of its contents, and copy them.
4. Paste everything into the SQL editor.
5. Click **Run** (or press `Cmd/Ctrl + Enter`).

You should see **Success. No rows returned** — that's exactly what we want.
It means the tables and rules were created. (The tables are empty for now;
we fill them in Step 6.)

If you see an error mentioning **"already exists"**, that's harmless — it just
means you ran the schema before. You can move on.

---

## Step 4 — Check the image storage bucket

The schema tries to create a storage bucket called **`product-images`** (this is
where product photos uploaded from the admin panel are stored). Some Supabase
plans don't allow creating buckets from SQL, so let's confirm it exists.

1. In the sidebar, click **Storage**.
2. Look for a bucket named **`product-images`**.

**If it's already there → great, skip to Step 5.**

**If it's missing, create it manually:**

1. Click **New bucket**.
2. **Name:** `product-images` (exactly — all lowercase, with the hyphen).
3. Turn **Public bucket ON** (so product photos are visible to shoppers).
4. Click **Create bucket**.

That's all. Write access is already restricted to logged-in admins by the
security rules from Step 3.

---

## Step 5 — Tell the website how to reach Supabase

Now we point the storefront and admin panel at your project.

1. On your computer, open the file **`assets/config.js`**.
2. You'll see something like this:

   ```js
   window.SH_CONFIG = {
     supabaseUrl: "",
     supabaseAnonKey: ""
   };
   ```

3. Paste in your **Project URL** and your **anon public** key (from Step 2 —
   the `public` one, **not** `service_role`):

   ```js
   window.SH_CONFIG = {
     supabaseUrl: "https://abcdefgh.supabase.co",
     supabaseAnonKey: "eyJhbGciOi...your-anon-public-key..."
   };
   ```

4. Save the file.

> **Both values are safe to put here and publish.** The anon key is *designed*
> to be public, and the security rules you ran in Step 3 make it read-only for
> the public site. Never paste the `service_role` key here.

At this point the storefront will read from Supabase — but the database is still
empty, so the next step loads your products in.

---

## Step 6 — Load your products into Supabase (the migration)

This is the one step that uses a command line. It runs a small script that reads
your existing `data/catalog.json` and uploads every product, category, and the FX
rate into Supabase. You run it **once** now, and again only if you ever want to
re-import from the catalog file.

You'll need **Node.js** installed. Check by running `node --version` — if you see
a version number (v18 or higher is ideal), you're good. If not, install it from
**https://nodejs.org** (choose the **LTS** version), then come back.

Open your **Terminal** and run these commands one block at a time.

**1. Go into the backend folder:**

```bash
cd /Users/praveenrathi/Desktop/sangamherbals-eu/backend
```

**2. Install the script's dependencies** (this creates a `node_modules` folder —
downloads a few packages, takes a moment):

```bash
npm install
```

**3. Create your private settings file** by copying the example:

```bash
cp .env.example .env
```

**4. Open the new `.env` file** in a text editor and fill in two values:

```
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...your-service_role-secret-key...
```

- `SUPABASE_URL` is the same Project URL from Step 2.
- `SUPABASE_SERVICE_ROLE_KEY` is the **`service_role` `secret`** key from Step 2
  — the powerful one. The migration needs it to write data. This file stays on
  your computer and is **never** published (see Security).

Save and close the file.

**5. Run the migration:**

```bash
npm run migrate
```

You'll see it print progress as it uploads categories and products. When it
finishes with something like **"Migration complete"**, your data is live in
Supabase.

**To confirm:** back in the Supabase dashboard, open **Table Editor** → choose
the **`products`** table. You should see all your products listed.

> If the script errors with something about a missing or invalid key, double-check
> that you pasted the **`service_role`** key (not the anon key) into `.env`, with
> no extra spaces or line breaks.

---

## Step 7 — Create your admin login and sign in

The admin panel is protected — only people you create an account for can edit
products. Create your own account now.

1. In the Supabase sidebar, click **Authentication**.
2. Click **Users**, then **Add user** → **Create new user**.
3. Enter:
   - **Email:** the email you'll log in with.
   - **Password:** a strong password you'll remember.
   - Tick **Auto Confirm User** (so you can log in immediately without a
     confirmation email).
4. Click **Create user**.

Now log in to the admin panel:

1. Open the site's **`admin.html`** page in your browser. Locally that's the
   `admin.html` file; once the site is published it's `https://your-site/admin.html`.
2. Enter the email and password you just created.
3. You're in — you can now add, edit, hide, and reorder products.

> Want to give someone else access later? Just repeat Step 7 to add another user.
> To revoke access, delete that user under **Authentication → Users**.

---

## Step 8 — How product edits go live

Once `assets/config.js` is filled in (Step 5), **the storefront reads from
Supabase automatically.** There's no rebuild and no deploy needed for content
changes:

- **Edit a product** in `/admin.html` → **Save** → reload the storefront and the
  change is there.
- **Hide a product** by un-ticking **Active** → it disappears from the storefront
  (it's not deleted, just soft-hidden — re-tick to bring it back).
- **Reorder** products with the **sort order** field for manual ordering.
- **Add a product** with the **New product** button, fill in the fields, upload
  images, **Save** → it appears on the storefront.

**The safety net:** if `assets/config.js` is still empty, or if Supabase is
temporarily unreachable, the storefront automatically falls back to the bundled
`data/catalog.json` file. The site keeps working no matter what — you just won't
see live edits until config is filled and Supabase is reachable. (`catalog.json`
is the original snapshot; it does **not** auto-update when you edit in the admin.
Supabase is the live source of truth once configured.)

---

## Security — please read this part

There are **two keys**, and the difference matters. Getting this right keeps your
store safe; getting it wrong could let a stranger edit or wipe your products.

### The anon (public) key — safe to publish

- Goes in **`assets/config.js`**, alongside the Project URL.
- It is **meant to be public** — every visitor's browser downloads it. That's
  normal and fine.
- The security rules (RLS) you ran in Step 3 make this key **read-only** for the
  public. Visitors can view products; they cannot change anything.
- ✅ Safe to commit to git. ✅ Safe to publish on the live site.

### The service_role (secret) key — never share, never commit

- Goes **only** in **`backend/.env`**, used only by the migration script on your
  own computer.
- It **bypasses all security rules** and can read, change, or delete everything.
  Treat it like the master password to your store.
- ❌ **Never** put it in `assets/config.js`.
- ❌ **Never** put it in any `.html`, `.js`, or other file the website ships.
- ❌ **Never** commit it to git or paste it into a chat, email, or screenshot.
- The project's `.gitignore` should already exclude `backend/.env`. Before you
  ever push, double-check the key isn't being committed:

  ```bash
  cd /Users/praveenrathi/Desktop/sangamherbals-eu
  git status
  ```

  If you see **`backend/.env`** in the list of changes, **stop** — do not commit.
  Make sure `.gitignore` contains a line reading `backend/.env`, then re-check.

**If the service_role key ever leaks** (committed by accident, shared, screenshotted):
go to Supabase → **Project Settings → API**, **roll/regenerate** the key, then
update `backend/.env` with the new one. Rolling it instantly invalidates the
leaked one.

### Committing `assets/config.js`

- It's fine to commit `assets/config.js` **with the Project URL and anon key**
  filled in — both are public by design, and the live site needs them.
- Just sanity-check before committing that the value next to `supabaseAnonKey`
  starts with the **anon** key, not the service_role key. A quick way to be sure:
  the key you put in `config.js` should be the same one labelled `public` in the
  Supabase API settings — never the one labelled `secret`.

---

## Quick reference

| Value | Safe to publish? | Lives in |
| --- | --- | --- |
| Project URL | ✅ Yes | `assets/config.js`, `backend/.env` |
| anon `public` key | ✅ Yes (read-only) | `assets/config.js` |
| service_role `secret` key | ❌ **NO — secret** | `backend/.env` only |
| Database password | ❌ **NO — secret** | your password manager |

**One-time setup recap:**

```text
1. Create free Supabase project
2. Copy Project URL + anon key + service_role key from Settings → API
3. SQL Editor → paste & run supabase/schema.sql
4. Storage → confirm the 'product-images' bucket exists (create it if missing)
5. Paste URL + anon key into assets/config.js
6. cd backend → npm install → cp .env.example .env → fill in URL + service_role key → npm run migrate
7. Authentication → Add user (email + password) → log in at /admin.html
8. Edit products in /admin.html — the storefront updates automatically
```

That's it. Your store is now backed by Supabase, editable from a friendly admin
panel, and safe by default.

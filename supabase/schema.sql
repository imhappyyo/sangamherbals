-- =============================================================================
-- SANGAM HERBALS — Supabase / Postgres schema  (v3  2026-06-25)
-- Idempotent: safe to run repeatedly (CREATE ... IF NOT EXISTS, DROP POLICY IF EXISTS).
--
-- Security model
-- ──────────────
--   products / categories / settings
--       SELECT  → anon + authenticated (public read for storefront)
--       INSERT / UPDATE / DELETE → authenticated + is_admin() only
--   orders
--       INSERT  → anon (anyone may place a pending order)
--       SELECT / UPDATE → authenticated + is_admin() only
--   storage bucket 'product-images'
--       SELECT  → public (storefront images)
--       INSERT / UPDATE / DELETE → authenticated + is_admin() only
--
-- Admin gate
-- ──────────
--   Being "authenticated" is NOT enough. The caller's JWT email must also
--   appear in public.admins — this blocks self-registered strangers.
--
-- How to set up an admin user
-- ────────────────────────────
--   1.  Run this script in the Supabase SQL editor (one time).
--   2.  Supabase → Authentication → Users → Invite user
--         email: sangamherbals@gmail.com   (set a strong password)
--   3.  Supabase → Authentication → Settings → Disable "Enable sign-ups"
--         so no one else can create an account.
--   4.  Open /admin.html and sign in with the credentials from step 2.
-- =============================================================================


-- =============================================================================
-- EXTENSIONS
-- =============================================================================
create extension if not exists "uuid-ossp";


-- =============================================================================
-- SHARED TRIGGER: updated_at
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- =============================================================================
-- TABLE: products
-- Round-trips identically to the storefront product shape (same field names).
-- =============================================================================
create table if not exists public.products (
  id              bigint        primary key,            -- numeric id from catalog, e.g. 942794467302
  sku             text          default '',
  title_en        text,
  title_ru        text,
  blurb_en        text,                                 -- short storefront description
  desc_ru         text,                                 -- legacy HTML, optional
  url_ru          text,                                 -- original source URL, optional
  price_eur       numeric,
  price_rub       numeric,
  section         text,                                 -- e.g. "КОСМЕТИКА"
  section_en      text,                                 -- e.g. "Cosmetics"
  section_slug    text,                                 -- ayurveda | cosmetics | food | oils | aromatherapy
  category_uids   jsonb         not null default '[]',  -- array of numbers
  category_names  jsonb         not null default '[]',  -- array of Russian strings
  category_en     jsonb         not null default '[]',  -- array of English strings
  image           text,                                 -- primary image URL
  images          jsonb         not null default '[]',  -- gallery image URLs
  concerns        jsonb         not null default '[]',  -- concern-key strings e.g. ["skin","hair"]
  concern_primary text,
  pdp             jsonb         not null default '{}',  -- full product-detail-page object
  active          boolean       not null default true,  -- false = hidden from storefront
  sort_order      integer       not null default 0,     -- lower = appears first
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);

create index if not exists products_section_slug_idx      on public.products (section_slug);
create index if not exists products_active_idx            on public.products (active);
create index if not exists products_sort_order_idx        on public.products (sort_order);
create index if not exists products_concerns_gin_idx      on public.products using gin (concerns);
create index if not exists products_category_uids_gin_idx on public.products using gin (category_uids);

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();


-- =============================================================================
-- TABLE: categories
-- =============================================================================
create table if not exists public.categories (
  uid          bigint   primary key,
  title        text,
  title_en     text,
  section      text,
  section_slug text,
  slug         text,
  is_section   boolean  not null default false
);

create index if not exists categories_section_slug_idx on public.categories (section_slug);


-- =============================================================================
-- TABLE: settings  (key / value store)
-- =============================================================================
create table if not exists public.settings (
  key   text  primary key,
  value jsonb not null
);


-- =============================================================================
-- TABLE: admins  (allow-list; only emails here may write via the admin panel)
-- =============================================================================
create table if not exists public.admins (
  email     text primary key,
  added_at  timestamptz not null default now()
);
alter table public.admins enable row level security;

-- Signed-in admin can read their own row (needed by the admin panel JWT check).
drop policy if exists admins_select_self on public.admins;
create policy admins_select_self
  on public.admins for select
  to authenticated
  using ((auth.jwt() ->> 'email') = email);


-- =============================================================================
-- FUNCTION: is_admin()
-- Returns true when the caller's JWT email is in public.admins.
-- SECURITY DEFINER so it can read public.admins even from within RLS policies.
-- =============================================================================
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where email = (auth.jwt() ->> 'email')
  );
$$;
revoke all   on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;


-- =============================================================================
-- ROW LEVEL SECURITY: products
-- =============================================================================
alter table public.products enable row level security;

drop policy if exists products_select_public        on public.products;
drop policy if exists products_insert_admin         on public.products;
drop policy if exists products_update_admin         on public.products;
drop policy if exists products_delete_admin         on public.products;
-- legacy names (drop them too so re-runs don't fail)
drop policy if exists products_insert_authenticated on public.products;
drop policy if exists products_update_authenticated on public.products;
drop policy if exists products_delete_authenticated on public.products;

create policy products_select_public
  on public.products for select
  to anon, authenticated
  using (true);

create policy products_insert_admin
  on public.products for insert
  to authenticated
  with check (public.is_admin());

create policy products_update_admin
  on public.products for update
  to authenticated
  using  (public.is_admin())
  with check (public.is_admin());

create policy products_delete_admin
  on public.products for delete
  to authenticated
  using (public.is_admin());


-- =============================================================================
-- ROW LEVEL SECURITY: categories
-- =============================================================================
alter table public.categories enable row level security;

drop policy if exists categories_select_public        on public.categories;
drop policy if exists categories_insert_admin         on public.categories;
drop policy if exists categories_update_admin         on public.categories;
drop policy if exists categories_delete_admin         on public.categories;
drop policy if exists categories_insert_authenticated on public.categories;
drop policy if exists categories_update_authenticated on public.categories;
drop policy if exists categories_delete_authenticated on public.categories;

create policy categories_select_public
  on public.categories for select
  to anon, authenticated
  using (true);

create policy categories_insert_admin
  on public.categories for insert
  to authenticated
  with check (public.is_admin());

create policy categories_update_admin
  on public.categories for update
  to authenticated
  using  (public.is_admin())
  with check (public.is_admin());

create policy categories_delete_admin
  on public.categories for delete
  to authenticated
  using (public.is_admin());


-- =============================================================================
-- ROW LEVEL SECURITY: settings
-- =============================================================================
alter table public.settings enable row level security;

drop policy if exists settings_select_public        on public.settings;
drop policy if exists settings_insert_admin         on public.settings;
drop policy if exists settings_update_admin         on public.settings;
drop policy if exists settings_delete_admin         on public.settings;
drop policy if exists settings_insert_authenticated on public.settings;
drop policy if exists settings_update_authenticated on public.settings;
drop policy if exists settings_delete_authenticated on public.settings;

create policy settings_select_public
  on public.settings for select
  to anon, authenticated
  using (true);

create policy settings_insert_admin
  on public.settings for insert
  to authenticated
  with check (public.is_admin());

create policy settings_update_admin
  on public.settings for update
  to authenticated
  using  (public.is_admin())
  with check (public.is_admin());

create policy settings_delete_admin
  on public.settings for delete
  to authenticated
  using (public.is_admin());


-- =============================================================================
-- STORAGE: 'product-images' bucket
-- Public read; admin-only write.
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists product_images_read_public          on storage.objects;
drop policy if exists product_images_insert_authenticated on storage.objects;
drop policy if exists product_images_update_authenticated on storage.objects;
drop policy if exists product_images_delete_authenticated on storage.objects;
drop policy if exists product_images_insert_admin         on storage.objects;
drop policy if exists product_images_update_admin         on storage.objects;
drop policy if exists product_images_delete_admin         on storage.objects;

create policy product_images_read_public
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'product-images');

create policy product_images_insert_admin
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

create policy product_images_update_admin
  on storage.objects for update
  to authenticated
  using  (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

create policy product_images_delete_admin
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-images' and public.is_admin());


-- =============================================================================
-- TABLE: orders
-- Written by the storefront checkout (anon INSERT only).
-- Read and managed by the admin panel (authenticated + is_admin()).
-- =============================================================================
create table if not exists public.orders (
  id                  uuid        primary key default gen_random_uuid(),

  -- Customer
  name                text,
  email               text,
  phone               text,
  country             text,
  address             jsonb,       -- {line, line2, city, postal, country}
  note                text,

  -- Cart
  items               jsonb,       -- [{id, title, qty, price_eur}]
  subtotal_eur        numeric,
  shipping_eur        numeric,
  total_eur           numeric,
  currency            text,
  locale              text,

  -- Payment
  payment_method      text,        -- whatsapp | email | stripe | paypal
  payment_ref         text,        -- Stripe session ID / PayPal capture ID
  amount_verified_eur numeric,     -- set ONLY by server-side Edge Function after verification

  -- Fulfilment
  -- Status lifecycle: pending → paid → confirmed → preparing → dispatched → delivered
  --                   any stage → cancelled
  status              text        not null default 'pending',
  tracking_number     text,
  tracking_url        text,
  dispatched_at       timestamptz,
  delivered_at        timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_status_idx  on public.orders (status);
create index if not exists orders_email_idx   on public.orders (email);

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.orders enable row level security;


-- =============================================================================
-- ROW LEVEL SECURITY: orders
-- =============================================================================
drop policy if exists orders_insert_public on public.orders;
drop policy if exists orders_select_admin  on public.orders;
drop policy if exists orders_update_admin  on public.orders;
drop policy if exists orders_delete_admin  on public.orders;

-- Anyone may place a new pending order.
-- Restrictions stop clients from setting a verified amount, a payment reference,
-- or any non-pending status. Edge Functions use the service_role key (bypasses RLS)
-- to flip the status to 'paid' after verifying the payment server-side.
create policy orders_insert_public
  on public.orders for insert
  to anon, authenticated
  with check (
    status            = 'pending'
    and amount_verified_eur is null
    and payment_ref         is null
    and payment_method in ('whatsapp', 'email', 'stripe', 'paypal')
  );

-- Only admins may read orders (customer self-tracking uses the get_order_status RPC).
create policy orders_select_admin
  on public.orders for select
  to authenticated
  using (public.is_admin());

-- Only admins may update orders (status changes, tracking, etc.).
create policy orders_update_admin
  on public.orders for update
  to authenticated
  using  (public.is_admin())
  with check (public.is_admin());

-- Admins may also delete orders (e.g. spam / test orders).
create policy orders_delete_admin
  on public.orders for delete
  to authenticated
  using (public.is_admin());


-- =============================================================================
-- FUNCTION: get_order_status(uuid)
-- Public, PII-free status lookup for the customer-facing order tracking page.
-- Returns only non-sensitive fields — no name, email, address, or payment info.
-- SECURITY DEFINER so anon callers can read this without hitting order RLS.
-- =============================================================================
create or replace function public.get_order_status(p_id uuid)
returns table (
  status          text,
  tracking_number text,
  tracking_url    text,
  created_at      timestamptz,
  dispatched_at   timestamptz,
  delivered_at    timestamptz,
  total_eur       numeric,
  currency        text,
  item_count      int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.status,
    o.tracking_number,
    o.tracking_url,
    o.created_at,
    o.dispatched_at,
    o.delivered_at,
    o.total_eur,
    o.currency,
    coalesce(jsonb_array_length(o.items), 0)::int
  from public.orders o
  where o.id = p_id;
$$;
revoke all   on function public.get_order_status(uuid) from public;
grant execute on function public.get_order_status(uuid) to anon, authenticated;


-- =============================================================================
-- SEED DATA
-- =============================================================================

-- EUR/RUB indicative rate (update periodically via the SQL editor).
insert into public.settings (key, value)
values ('fx_rub_eur', '0.011'::jsonb)
on conflict (key) do nothing;

-- doshas jsonb column: which doshas a product is suited for (set in admin editor or via import)
alter table public.products add column if not exists doshas jsonb not null default '[]';

-- featured_product_id: the product shown in the homepage spotlight. Change via admin Settings.
insert into public.settings (key, value)
values ('featured_product_id', '"296624096"'::jsonb)
on conflict (key) do nothing;

-- site_notice: banner shown across the top of the storefront.
insert into public.settings (key, value)
values ('site_notice', '{"enabled":false,"text":"We are experiencing high demand — every order is confirmed personally within 24 hours."}'::jsonb)
on conflict (key) do nothing;

-- ─── Newsletter subscribers ──────────────────────────────────────────────────
create table if not exists public.newsletter_subscribers (
  email       text primary key,
  subscribed_at timestamptz not null default now()
);

-- RLS: anon can insert only (no read, no update, no delete via anon key)
alter table public.newsletter_subscribers enable row level security;
drop policy if exists "anon_insert_newsletter" on public.newsletter_subscribers;
create policy "anon_insert_newsletter"
  on public.newsletter_subscribers for insert
  to anon
  with check (true);

-- Admin reads subscriber list (service-role or authenticated admin)
drop policy if exists "admin_select_newsletter" on public.newsletter_subscribers;
create policy "admin_select_newsletter"
  on public.newsletter_subscribers for select
  to authenticated
  using (exists (select 1 from public.admins a where a.email = auth.email()));

-- ─── Admin user ───────────────────────────────────────────────────────────────
-- This seeds the email allow-list. You still need to create the actual Supabase
-- Auth user manually:
--   Supabase dashboard → Authentication → Users → "Invite user"
--   Email: sangamherbals@gmail.com   (set a strong password)
--   Then disable sign-ups so strangers cannot self-register.
-- ──────────────────────────────────────────────────────────────────────────────
insert into public.admins (email)
values ('sangamherbals@gmail.com')
on conflict (email) do nothing;

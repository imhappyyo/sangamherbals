-- ============================================================================
-- ORDER TRACKING — run this ONCE in Supabase → SQL Editor.
-- (Safe to re-run. If you set up a fresh project from schema.sql, it's already
--  included there — this file is just the delta for an existing project.)
--
-- It adds tracking columns to orders, and a public, PII-free lookup function so
-- a customer can track THEIR OWN order (by its unguessable reference) without
-- logging in — and without exposing anyone's name/email/address.
-- ============================================================================

-- 1) tracking columns on orders
alter table public.orders
  add column if not exists tracking_number text,
  add column if not exists tracking_url    text,
  add column if not exists dispatched_at   timestamptz,
  add column if not exists delivered_at    timestamptz;

-- 2) public order-status lookup (returns ONLY non-personal status fields)
create or replace function public.get_order_status(p_id uuid)
returns table (
  status         text,
  tracking_number text,
  tracking_url   text,
  created_at     timestamptz,
  dispatched_at  timestamptz,
  delivered_at   timestamptz,
  total_eur      numeric,
  currency       text,
  item_count     int
)
language sql
stable
security definer
set search_path = public
as $$
  select o.status, o.tracking_number, o.tracking_url,
         o.created_at, o.dispatched_at, o.delivered_at,
         o.total_eur, o.currency,
         coalesce(jsonb_array_length(o.items), 0)
  from public.orders o
  where o.id = p_id;
$$;

revoke all on function public.get_order_status(uuid) from public;
grant execute on function public.get_order_status(uuid) to anon, authenticated;

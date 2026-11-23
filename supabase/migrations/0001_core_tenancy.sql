-- ════════════════════════════════════════════════════════════════════════
-- HISAAB POS — 0001 core tenancy
-- Multi-tenant schema + Row Level Security.
--
-- RUN THIS IN: Supabase Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: tables use IF NOT EXISTS and policies are recreated.
--
-- TENANCY MODEL
--   auth.users          → identity (Supabase Auth)
--   profiles            → 1:1 with auth.users
--   organizations       → a business / tenant
--   org_members         → which users may access which organization
--   stores              → physical shops inside an organization
--   <business data>     → always carries org_id, protected by RLS
--
-- Every business table is readable/writable ONLY by members of its org.
-- That isolation is enforced in the database, not just the frontend.
-- ════════════════════════════════════════════════════════════════════════

begin;

create extension if not exists pgcrypto;

-- ────────────────────────────────────────────────────────────────────────
-- 0. Helpers
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- 1. Identity
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  phone       text,
  avatar_url  text,
  locale      text not null default 'en-IN',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Create a profile automatically for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      split_part(coalesce(new.email, 'shop owner'), '@', 1)
    ),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ────────────────────────────────────────────────────────────────────────
-- 2. Plans (platform catalogue, public read-only)
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.plans (
  id            text primary key,
  name          text not null,
  tagline       text not null default '',
  badge         text not null default '',
  price_monthly integer not null default 0,   -- paise
  price_yearly  integer not null default 0,   -- paise
  currency      text not null default 'INR',
  limits        jsonb not null default '{}'::jsonb,
  features      text[] not null default '{}',
  highlights    text[] not null default '{}',
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

insert into public.plans (id, name, tagline, badge, price_monthly, price_yearly, limits, features, highlights, sort_order)
values
  ('free', 'Free', 'Everything you need to start billing.', 'Free forever', 0, 0,
   '{"billsPerMonth":50,"products":100,"devices":1}'::jsonb,
   array['billing','inventory','receipts','sales_history','customers','whatsapp_share','expiry_alerts'],
   array['50 bills per month','Up to 100 products','Thermal & A4 receipts','Low-stock and expiry alerts','WhatsApp text bill sharing'],
   0),
  ('starter', 'Starter', 'For busy shops that bill every day.', 'Most popular', 29900, 299900,
   '{"billsPerMonth":1000,"products":2000,"devices":3}'::jsonb,
   array['billing','inventory','receipts','sales_history','customers','whatsapp_share','expiry_alerts',
         'returns','stock_timeline','damage_tracking','csv_export','whatsapp_pdf'],
   array['1,000 bills per month','Up to 2,000 products','Sales returns & damaged stock','Stock movement timeline','CSV export & WhatsApp PDF'],
   1),
  ('pro', 'Pro', 'Unlimited billing for growing businesses.', 'Best value', 69900, 699900,
   '{"billsPerMonth":null,"products":null,"devices":10}'::jsonb,
   array['billing','inventory','receipts','sales_history','customers','whatsapp_share','expiry_alerts',
         'returns','stock_timeline','damage_tracking','csv_export','whatsapp_pdf',
         'advanced_reports','multi_store','priority_support','api_access'],
   array['Unlimited bills','Unlimited products','Advanced reports','Multi-store ready','Priority support & API access'],
   2)
on conflict (id) do update set
  name          = excluded.name,
  tagline       = excluded.tagline,
  badge         = excluded.badge,
  price_monthly = excluded.price_monthly,
  price_yearly  = excluded.price_yearly,
  limits        = excluded.limits,
  features      = excluded.features,
  highlights    = excluded.highlights,
  sort_order    = excluded.sort_order,
  is_active     = true,
  updated_at    = now();

-- ────────────────────────────────────────────────────────────────────────
-- 3. Organizations & membership (the tenant boundary)
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  slug        text not null unique,
  owner_id    uuid not null references auth.users (id) on delete restrict,
  plan_id     text not null default 'free' references public.plans (id),
  status      text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  country     text not null default 'IN',
  currency    text not null default 'INR',
  timezone    text not null default 'Asia/Kolkata',
  gstin       text,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.org_members (
  org_id      uuid not null references public.organizations (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'staff' check (role in ('owner', 'admin', 'staff')),
  status      text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  invited_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists org_members_user_idx on public.org_members (user_id);

-- Never allow the last active owner of an organization to be removed or demoted.
create or replace function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_remaining integer;
begin
  if old.role = 'owner' then
    if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.role <> 'owner') then
      select count(*) into v_remaining
      from public.org_members
      where org_id = old.org_id
        and role = 'owner'
        and status = 'active'
        and user_id <> old.user_id;

      if v_remaining = 0 then
        raise exception 'An organization must keep at least one owner.'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists org_members_protect_owner on public.org_members;
create trigger org_members_protect_owner
  before update or delete on public.org_members
  for each row execute function public.protect_last_owner();

-- Is the caller an active member of this organization?
-- SECURITY DEFINER so policy checks on org_members do not recurse, and so
-- the check itself cannot be bypassed by manipulating the caller's rows.
-- Defined here (after org_members exists) because SQL-language functions
-- validate referenced relations at creation time.
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

-- Is the caller an owner/admin of this organization?
create or replace function public.is_org_admin(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin')
  );
$$;

-- ────────────────────────────────────────────────────────────────────────
-- 4. Stores (a shop inside an organization)
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.stores (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  phone       text,
  email       text,
  address     text,
  city        text,
  state       text,
  pincode     text,
  gstin       text,
  invoice_prefix text not null default 'INV-',
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists stores_org_idx on public.stores (org_id);
create unique index if not exists stores_one_default_per_org
  on public.stores (org_id) where is_default;

-- ────────────────────────────────────────────────────────────────────────
-- 5. Subscriptions, payments, usage
-- ────────────────────────────────────────────────────────────────────────

-- One current subscription row per organization.
create table if not exists public.subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null unique references public.organizations (id) on delete cascade,
  plan_id                text not null references public.plans (id),
  status                 text not null default 'active'
                         check (status in ('active', 'trialing', 'past_due', 'canceled', 'expired')),
  cycle                  text not null default 'monthly' check (cycle in ('monthly', 'yearly')),
  current_period_start   timestamptz not null default now(),
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  provider               text not null default 'mock' check (provider in ('mock', 'razorpay', 'manual')),
  provider_subscription_id text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id) on delete cascade,
  subscription_id     uuid references public.subscriptions (id) on delete set null,
  amount              integer not null check (amount >= 0),   -- paise
  currency            text not null default 'INR',
  provider            text not null default 'mock' check (provider in ('mock', 'razorpay', 'manual')),
  provider_payment_id text unique,
  provider_order_id   text,
  status              text not null default 'captured'
                      check (status in ('created', 'captured', 'failed', 'refunded')),
  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists payments_org_idx on public.payments (org_id, created_at desc);

-- Calendar-month counters. `period` is the first day of the month.
create table if not exists public.usage_counters (
  org_id      uuid not null references public.organizations (id) on delete cascade,
  period      date not null,
  kind        text not null check (kind in ('bill', 'return', 'whatsapp', 'export', 'products')),
  count       bigint not null default 0 check (count >= 0),
  updated_at  timestamptz not null default now(),
  primary key (org_id, period, kind)
);

-- ────────────────────────────────────────────────────────────────────────
-- 6. Catalogue & inventory
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  emoji       text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists categories_org_idx on public.categories (org_id);
create unique index if not exists categories_org_name_key
  on public.categories (org_id, lower(name));

create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  category_id     uuid references public.categories (id) on delete set null,
  name            text not null check (char_length(btrim(name)) between 1 and 200),
  sku             text,
  barcode         text,
  unit            text not null default 'Pcs',
  price           numeric(12, 2) not null default 0 check (price >= 0),          -- selling price
  mrp             numeric(12, 2) not null default 0 check (mrp >= 0),
  purchase_price  numeric(12, 2) not null default 0 check (purchase_price >= 0),
  tax_rate        numeric(5, 2) not null default 0 check (tax_rate >= 0),
  tax_inclusive   boolean not null default true,
  stock           numeric(12, 3) not null default 0,
  min_stock       numeric(12, 3) not null default 5,
  discount_type   text not null default 'percent' check (discount_type in ('percent', 'amount')),
  discount        numeric(12, 2) not null default 0 check (discount >= 0),
  track_expiry    boolean not null default false,
  expiry_date     date,
  warranty_months integer,
  emoji           text,
  is_active       boolean not null default true,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists products_org_idx on public.products (org_id, is_active);
create index if not exists products_org_name_idx on public.products (org_id, lower(name));
create unique index if not exists products_org_barcode_key
  on public.products (org_id, barcode) where barcode is not null and barcode <> '';
create unique index if not exists products_org_sku_key
  on public.products (org_id, sku) where sku is not null and sku <> '';

-- Forward-compatible: variants are deferred in V1, the table exists so the
-- catalogue can grow without a migration later.
create table if not exists public.product_variants (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  name        text not null,
  sku         text,
  barcode     text,
  price       numeric(12, 2) not null default 0 check (price >= 0),
  stock       numeric(12, 3) not null default 0,
  attributes  jsonb not null default '{}'::jsonb,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists product_variants_org_idx on public.product_variants (org_id, product_id);

-- Append-only stock ledger. The current stock level lives on products.stock;
-- every change should also be recorded here with qty_after for an audit trail.
create table if not exists public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  store_id      uuid references public.stores (id) on delete set null,
  product_id    uuid references public.products (id) on delete set null,
  product_name  text not null default '',
  barcode       text,
  type          text not null check (type in ('created', 'added', 'sold', 'deleted', 'adjusted', 'damaged', 'returned')),
  qty_change    numeric(12, 3) not null default 0,
  qty_after     numeric(12, 3) not null default 0,
  note          text,
  ref_type      text,
  ref_id        uuid,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists stock_movements_org_idx on public.stock_movements (org_id, created_at desc);
create index if not exists stock_movements_product_idx on public.stock_movements (org_id, product_id, created_at desc);

-- ────────────────────────────────────────────────────────────────────────
-- 7. Customers
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  phone       text,
  email       text,
  address     text,
  notes       text,
  -- positive = customer owes the shop (due), negative = advance paid
  balance     numeric(12, 2) not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists customers_org_idx on public.customers (org_id, lower(name));
create unique index if not exists customers_org_phone_key
  on public.customers (org_id, phone) where phone is not null and phone <> '';

-- ────────────────────────────────────────────────────────────────────────
-- 8. Sales (the invoice) & sale items
-- ────────────────────────────────────────────────────────────────────────
-- A POS sale IS the invoice: `sales` is the header, `sale_items` the lines.
-- A separate invoices table would duplicate every column, so we keep one
-- source of truth and treat the pair as the immutable invoice.

create table if not exists public.sales (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  store_id        uuid not null references public.stores (id) on delete restrict,
  invoice_no      integer not null check (invoice_no > 0),
  customer_id     uuid references public.customers (id) on delete set null,
  customer_name   text not null default 'Walk-in',
  customer_phone  text,
  subtotal        numeric(12, 2) not null default 0,
  discount        numeric(12, 2) not null default 0,
  tax             numeric(12, 2) not null default 0,
  total           numeric(12, 2) not null default 0,
  paid            numeric(12, 2) not null default 0,
  balance_due     numeric(12, 2) not null default 0,
  payment_method  text not null default 'cash',
  status          text not null default 'completed' check (status in ('completed', 'voided')),
  note            text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  voided_at       timestamptz,
  voided_by       uuid references auth.users (id) on delete set null,
  unique (store_id, invoice_no)
);

create index if not exists sales_org_idx on public.sales (org_id, created_at desc);
create index if not exists sales_store_idx on public.sales (store_id, created_at desc);
create index if not exists sales_customer_idx on public.sales (org_id, customer_id);

create table if not exists public.sale_items (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  sale_id           uuid not null references public.sales (id) on delete cascade,
  product_id        uuid references public.products (id) on delete set null,
  -- snapshots: the invoice must never change when a product is edited
  name              text not null,
  barcode           text,
  unit              text not null default 'Pcs',
  qty               numeric(12, 3) not null check (qty > 0),
  unit_price        numeric(12, 2) not null default 0,
  discount          numeric(12, 2) not null default 0,
  tax_rate          numeric(5, 2) not null default 0,
  line_total        numeric(12, 2) not null default 0,
  created_at        timestamptz not null default now()
);

create index if not exists sale_items_sale_idx on public.sale_items (sale_id);
create index if not exists sale_items_org_idx on public.sale_items (org_id);

-- ────────────────────────────────────────────────────────────────────────
-- 9. Damages, returns, payment methods
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.damages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  store_id    uuid references public.stores (id) on delete set null,
  product_id  uuid references public.products (id) on delete set null,
  product_name text not null default '',
  qty         numeric(12, 3) not null check (qty > 0),
  reason      text,
  loss_value  numeric(12, 2) not null default 0,
  logged_by   uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists damages_org_idx on public.damages (org_id, created_at desc);

create table if not exists public.returns (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  store_id    uuid references public.stores (id) on delete set null,
  sale_id     uuid references public.sales (id) on delete set null,
  product_id  uuid references public.products (id) on delete set null,
  product_name text not null default '',
  qty         numeric(12, 3) not null check (qty > 0),
  amount      numeric(12, 2) not null default 0,
  reason      text,
  processed_by uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists returns_org_idx on public.returns (org_id, created_at desc);

create table if not exists public.payment_methods (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  kind        text not null default 'cash' check (kind in ('cash', 'upi', 'card', 'credit', 'wallet', 'other')),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists payment_methods_org_idx on public.payment_methods (org_id);

-- ────────────────────────────────────────────────────────────────────────
-- 10. Organization bootstrap RPC
-- ────────────────────────────────────────────────────────────────────────
-- Organization creation is transactional (org + owner membership + first
-- store + free subscription). Direct INSERTs into organizations are denied,
-- so a tenant can never be created without an owner.

create or replace function public.create_organization(
  p_name          text,
  p_store_name    text default null,
  p_phone         text default null,
  p_address       text default null,
  p_city          text default null,
  p_state         text default null,
  p_pincode       text default null,
  p_gstin         text default null,
  p_business_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_org        public.organizations;
  v_store      public.stores;
  v_slug       text;
  v_store_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if p_name is null or char_length(btrim(p_name)) = 0 then
    raise exception 'Organization name is required' using errcode = 'check_violation';
  end if;

  v_store_name := coalesce(nullif(btrim(coalesce(p_store_name, '')), ''), btrim(p_name));

  v_slug := lower(regexp_replace(btrim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_slug := btrim(v_slug, '-');
  if v_slug = '' then
    v_slug := 'shop';
  end if;
  v_slug := left(v_slug, 40) || '-' || substr(replace(v_uid::text, '-', ''), 1, 6);

  insert into public.organizations (name, slug, owner_id, plan_id, gstin)
  values (btrim(p_name), v_slug, v_uid, 'free', nullif(btrim(coalesce(p_gstin, '')), ''))
  returning * into v_org;

  insert into public.org_members (org_id, user_id, role, status)
  values (v_org.id, v_uid, 'owner', 'active');

  insert into public.stores (
    org_id, name, phone, address, city, state, pincode, gstin,
    is_default, settings
  )
  values (
    v_org.id, v_store_name, nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_state, '')), ''),
    nullif(btrim(coalesce(p_pincode, '')), ''),
    nullif(btrim(coalesce(p_gstin, '')), ''),
    true,
    jsonb_build_object('businessType', coalesce(nullif(btrim(coalesce(p_business_type, '')), ''), 'Retail store'))
  )
  returning * into v_store;

  insert into public.subscriptions (
    org_id, plan_id, status, cycle, current_period_start, current_period_end, provider
  )
  values (v_org.id, 'free', 'active', 'monthly', now(), null, 'manual');

  insert into public.payment_methods (org_id, name, kind, sort_order)
  values
    (v_org.id, 'Cash', 'cash', 0),
    (v_org.id, 'UPI', 'upi', 1),
    (v_org.id, 'Card', 'card', 2)
  on conflict do nothing;

  return jsonb_build_object(
    'organization', to_jsonb(v_org),
    'store', to_jsonb(v_store)
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- 11. Row Level Security
-- ────────────────────────────────────────────────────────────────────────

alter table public.profiles          enable row level security;
alter table public.organizations     enable row level security;
alter table public.org_members       enable row level security;
alter table public.stores            enable row level security;
alter table public.plans             enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.payments          enable row level security;
alter table public.usage_counters    enable row level security;
alter table public.categories        enable row level security;
alter table public.products          enable row level security;
alter table public.product_variants  enable row level security;
alter table public.stock_movements   enable row level security;
alter table public.customers         enable row level security;
alter table public.sales             enable row level security;
alter table public.sale_items        enable row level security;
alter table public.damages           enable row level security;
alter table public.returns           enable row level security;
alter table public.payment_methods   enable row level security;

-- profiles: a user can only see and edit their own profile
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- organizations: members read, admins update. No client INSERT/DELETE:
-- creation must go through create_organization().
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (public.is_org_member(id));

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update to authenticated
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));

-- org_members: a user sees their own memberships plus everyone in their orgs
drop policy if exists org_members_select on public.org_members;
create policy org_members_select on public.org_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_org_member(org_id));

drop policy if exists org_members_insert on public.org_members;
create policy org_members_insert on public.org_members
  for insert to authenticated
  with check (public.is_org_admin(org_id));

drop policy if exists org_members_update on public.org_members;
create policy org_members_update on public.org_members
  for update to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

drop policy if exists org_members_delete on public.org_members;
create policy org_members_delete on public.org_members
  for delete to authenticated
  using (public.is_org_admin(org_id));

-- plans: public price list, read-only
drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans
  for select to anon, authenticated
  using (is_active);

-- stores
drop policy if exists stores_select on public.stores;
create policy stores_select on public.stores
  for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists stores_insert on public.stores;
create policy stores_insert on public.stores
  for insert to authenticated
  with check (public.is_org_admin(org_id));

drop policy if exists stores_update on public.stores;
create policy stores_update on public.stores
  for update to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

drop policy if exists stores_delete on public.stores;
create policy stores_delete on public.stores
  for delete to authenticated
  using (public.is_org_admin(org_id));

-- subscriptions & payments: members can read, only the server (service_role)
-- can write. No INSERT/UPDATE/DELETE policies on purpose.
drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions
  for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (public.is_org_member(org_id));

-- usage counters: readable by members, written by the server
drop policy if exists usage_counters_select on public.usage_counters;
create policy usage_counters_select on public.usage_counters
  for select to authenticated
  using (public.is_org_member(org_id));

-- Simple tenant tables: any active member may read and write their org's rows.
do $$
declare
  t text;
begin
  foreach t in array array[
    'categories', 'products', 'product_variants', 'stock_movements',
    'customers', 'payment_methods'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_org_member(org_id))',
      t || '_select', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_org_member(org_id))',
      t || '_insert', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id))',
      t || '_update', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_org_member(org_id))',
      t || '_delete', t
    );
  end loop;
end;
$$;

-- sales: members create and read; only admins may void/delete
drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales
  for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists sales_insert on public.sales;
create policy sales_insert on public.sales
  for insert to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists sales_update on public.sales;
create policy sales_update on public.sales
  for update to authenticated
  using (public.is_org_admin(org_id))
  with check (public.is_org_admin(org_id));

drop policy if exists sales_delete on public.sales;
create policy sales_delete on public.sales
  for delete to authenticated
  using (public.is_org_admin(org_id));

-- sale_items: append-only. No UPDATE/DELETE policies (invoice lines are
-- immutable); rows are removed by the ON DELETE CASCADE when a sale is
-- deleted by an admin.
drop policy if exists sale_items_select on public.sale_items;
create policy sale_items_select on public.sale_items
  for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists sale_items_insert on public.sale_items;
create policy sale_items_insert on public.sale_items
  for insert to authenticated
  with check (public.is_org_member(org_id));

-- damages & returns: members
drop policy if exists damages_select on public.damages;
create policy damages_select on public.damages
  for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists damages_insert on public.damages;
create policy damages_insert on public.damages
  for insert to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists damages_delete on public.damages;
create policy damages_delete on public.damages
  for delete to authenticated
  using (public.is_org_admin(org_id));

drop policy if exists returns_select on public.returns;
create policy returns_select on public.returns
  for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists returns_insert on public.returns;
create policy returns_insert on public.returns
  for insert to authenticated
  with check (public.is_org_member(org_id));

drop policy if exists returns_delete on public.returns;
create policy returns_delete on public.returns
  for delete to authenticated
  using (public.is_org_admin(org_id));

-- ────────────────────────────────────────────────────────────────────────
-- 12. Grants
-- ────────────────────────────────────────────────────────────────────────

grant usage on schema public to anon, authenticated;

grant select on public.plans to anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, update on public.organizations to authenticated;
grant select, insert, update, delete on public.org_members to authenticated;
grant select, insert, update, delete on public.stores to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.payments to authenticated;
grant select on public.usage_counters to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.product_variants to authenticated;
grant select, insert, update, delete on public.stock_movements to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.payment_methods to authenticated;
grant select, insert, update, delete on public.sales to authenticated;
grant select, insert, delete on public.sale_items to authenticated;
grant select, insert, delete on public.damages to authenticated;
grant select, insert, delete on public.returns to authenticated;

-- Make sure clients can never write billing rows directly.
revoke insert, update, delete on public.subscriptions from anon, authenticated;
revoke insert, update, delete on public.payments from anon, authenticated;
revoke insert, update, delete on public.usage_counters from anon, authenticated;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;
grant execute on function public.create_organization(text, text, text, text, text, text, text, text, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 13. updated_at triggers
-- ────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'plans', 'organizations', 'org_members', 'stores',
    'subscriptions', 'categories', 'products', 'product_variants',
    'customers', 'payment_methods'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end;
$$;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- Done. Next:
--   1. Authentication → Providers → Email: turn ON.
--      For the fastest local onboarding, turn "Confirm email" OFF.
--   2. Copy your Project URL + anon public key into config.js.
-- ════════════════════════════════════════════════════════════════════════

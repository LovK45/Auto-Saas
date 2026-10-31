-- Private digital-delivery entitlements tied to Stripe-verified purchases.
alter table public.stripe_products
  add column if not exists delivery_bucket text,
  add column if not exists delivery_path text;

create table if not exists public.purchase_entitlements (
  id uuid primary key default gen_random_uuid(),
  stripe_checkout_session_id text not null unique references public.purchases(stripe_checkout_session_id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_key text not null,
  customer_email text not null,
  storage_bucket text not null,
  storage_path text not null,
  entitlement_status text not null default 'inactive'
    check (entitlement_status in ('active','inactive','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists purchase_entitlements_customer_idx
  on public.purchase_entitlements(lower(customer_email), entitlement_status);
create index if not exists purchase_entitlements_owner_idx
  on public.purchase_entitlements(owner_id, created_at desc);
alter table public.purchase_entitlements enable row level security;
revoke all on public.purchase_entitlements from anon, authenticated;
-- No browser can list or modify entitlements. Edge Function validates the signed-in customer's email.

-- Private bucket: files must be uploaded to this bucket; do not use public URLs.
insert into storage.buckets (id, name, public, file_size_limit)
values ('customer-deliveries', 'customer-deliveries', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

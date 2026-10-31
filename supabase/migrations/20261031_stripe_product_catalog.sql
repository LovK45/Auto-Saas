-- Server-managed Stripe price catalog. Only trusted administrators/service role may manage prices.
-- PostgreSQL requires the referenced composite unique key to exist before creating the foreign key.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'workspaces_id_owner_id_unique'
  ) then
    alter table public.workspaces add constraint workspaces_id_owner_id_unique unique (id, owner_id);
  end if;
end $$;

create table if not exists public.stripe_products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null,
  product_key text not null,
  stripe_price_id text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(workspace_id, product_key),
  unique(stripe_price_id),
  foreign key (workspace_id, owner_id)
    references public.workspaces(id, owner_id) on delete cascade
);
alter table public.stripe_products enable row level security;
revoke all on public.stripe_products from anon, authenticated;
-- Edge Functions use the service-role key after independently verifying the user's JWT and workspace ownership.

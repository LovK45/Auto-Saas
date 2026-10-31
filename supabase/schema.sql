-- Autopilot Growth OS — Supabase schema
-- Run in the Supabase SQL Editor. All workspace data is scoped to auth.uid().
create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'My workspace',
  created_at timestamptz not null default now()
);
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  offer text not null,
  audience text,
  channel text not null,
  status text not null default 'draft' check (status in ('draft','active','paused','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  first_name text,
  source text,
  consent_at timestamptz not null,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);
create table if not exists public.content_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled draft',
  format text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft','approved','published','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.partner_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  destination_url text not null,
  commission_notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.growth_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  stripe_checkout_session_id text unique not null,
  stripe_payment_intent_id text,
  product_key text not null,
  amount_total integer not null check (amount_total >= 0),
  currency text not null,
  payment_status text not null check (payment_status in ('paid','unpaid','no_payment_required')),
  created_at timestamptz not null default now()
);

create index if not exists campaigns_owner_idx on public.campaigns(owner_id, created_at desc);
create index if not exists leads_owner_idx on public.leads(owner_id, created_at desc);
create index if not exists drafts_owner_idx on public.content_drafts(owner_id, updated_at desc);
create index if not exists events_owner_idx on public.growth_events(owner_id, created_at desc);

alter table public.workspaces enable row level security;
alter table public.campaigns enable row level security;
alter table public.leads enable row level security;
alter table public.content_drafts enable row level security;
alter table public.partner_links enable row level security;
alter table public.growth_events enable row level security;
alter table public.purchases enable row level security;

-- Workspace owners can only access rows tied to their own auth identity.
drop policy if exists "workspace owner access" on public.workspaces;
create policy "workspace owner access" on public.workspaces for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "campaign owner access" on public.campaigns;
create policy "campaign owner access" on public.campaigns for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "lead owner access" on public.leads;
create policy "lead owner access" on public.leads for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "draft owner access" on public.content_drafts;
create policy "draft owner access" on public.content_drafts for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "partner owner access" on public.partner_links;
create policy "partner owner access" on public.partner_links for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "event owner access" on public.growth_events;
create policy "event owner access" on public.growth_events for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "purchase owner read" on public.purchases;
create policy "purchase owner read" on public.purchases for select to authenticated using (owner_id = auth.uid());

-- Purchase rows are written only by the Stripe webhook using the service role.
revoke all on public.purchases from anon, authenticated;
grant select on public.purchases to authenticated;

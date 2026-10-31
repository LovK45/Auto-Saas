-- Autopilot Growth OS Supabase schema
create extension if not exists pgcrypto;
create table if not exists public.workspaces (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, name text not null default 'My workspace', created_at timestamptz not null default now());
create table if not exists public.campaigns (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, owner_id uuid not null references auth.users(id) on delete cascade, name text not null, offer text not null, audience text, channel text not null, status text not null default 'draft' check (status in ('draft','active','paused','completed')), created_at timestamptz not null default now());
create table if not exists public.leads (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, owner_id uuid not null references auth.users(id) on delete cascade, email text not null, first_name text, source text, consent_at timestamptz not null, unsubscribed_at timestamptz, created_at timestamptz not null default now(), unique(workspace_id,email));
create table if not exists public.content_drafts (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, owner_id uuid not null references auth.users(id) on delete cascade, title text not null default 'Untitled draft', format text not null, body text not null, status text not null default 'draft', created_at timestamptz not null default now());
create table if not exists public.partner_links (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade, owner_id uuid not null references auth.users(id) on delete cascade, name text not null, destination_url text not null, commission_notes text, created_at timestamptz not null default now());
create table if not exists public.purchases (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, stripe_checkout_session_id text unique not null, stripe_payment_intent_id text, product_key text not null, amount_total integer not null check(amount_total>=0), currency text not null, payment_status text not null, created_at timestamptz not null default now());
alter table public.workspaces enable row level security;
alter table public.campaigns enable row level security;
alter table public.leads enable row level security;
alter table public.content_drafts enable row level security;
alter table public.partner_links enable row level security;
alter table public.purchases enable row level security;
create policy "workspace owner access" on public.workspaces for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy "campaign owner access" on public.campaigns for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy "lead owner access" on public.leads for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy "draft owner access" on public.content_drafts for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy "partner owner access" on public.partner_links for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy "purchase owner read" on public.purchases for select to authenticated using(owner_id=auth.uid());
revoke all on public.purchases from anon, authenticated;
grant select on public.purchases to authenticated;


-- One private JSON snapshot per authenticated user for cross-device workspace backup.
create table if not exists public.workspace_snapshots (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.workspace_snapshots enable row level security;
drop policy if exists "snapshot owner access" on public.workspace_snapshots;
create policy "snapshot owner access" on public.workspace_snapshots for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on public.workspace_snapshots to authenticated;

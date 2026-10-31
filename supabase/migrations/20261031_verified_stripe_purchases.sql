-- Verified Stripe purchase ledger. Apply after the original schema.sql.
-- Existing purchase rows remain readable; new webhook fields are nullable where historical data is unknown.
alter table public.purchases
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null,
  add column if not exists stripe_customer_id text,
  add column if not exists customer_email text,
  add column if not exists amount_refunded integer not null default 0 check (amount_refunded >= 0),
  add column if not exists paid_at timestamptz,
  add column if not exists refunded_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.purchases
  drop constraint if exists purchases_payment_status_check;
alter table public.purchases
  add constraint purchases_payment_status_check
  check (payment_status in ('pending','paid','failed','partially_refunded','refunded'));

create index if not exists purchases_owner_created_idx
  on public.purchases(owner_id, created_at desc);
create index if not exists purchases_payment_intent_idx
  on public.purchases(stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- Event IDs provide idempotency. This table is service-role only; it has no browser policies or grants.
create table if not exists public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  processing_status text not null check (processing_status in ('processing','processed')),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from anon, authenticated;
revoke insert, update, delete on public.purchases from anon, authenticated;
grant select on public.purchases to authenticated;

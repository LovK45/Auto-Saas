-- Private transactional email status for Stripe-confirmed purchases.
create table if not exists public.purchase_email_notifications (
  stripe_checkout_session_id text primary key references public.purchases(stripe_checkout_session_id) on delete cascade,
  recipient_email text not null,
  product_name text not null,
  status text not null default 'pending'
    check (status in ('pending','sent','failed')),
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Additive upgrade path for projects that already applied the first version of this migration.
alter table public.purchase_email_notifications
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.purchase_email_notifications
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.purchase_email_notifications
  add column if not exists attempt_count integer not null default 0;
alter table public.purchase_email_notifications
  add column if not exists last_attempt_at timestamptz;

update public.purchase_email_notifications n
set owner_id = p.owner_id, workspace_id = p.workspace_id
from public.purchases p
where p.stripe_checkout_session_id = n.stripe_checkout_session_id
  and (n.owner_id is null or n.workspace_id is null);

do $$
begin
  if exists (select 1 from public.purchase_email_notifications where owner_id is null or workspace_id is null) then
    raise exception 'Cannot enforce notification ownership: matching purchase owner/workspace data is missing';
  end if;
end $$;

alter table public.purchase_email_notifications
  alter column owner_id set not null,
  alter column workspace_id set not null;

alter table public.purchase_email_notifications
  drop constraint if exists purchase_email_notifications_attempt_count_check;
alter table public.purchase_email_notifications
  add constraint purchase_email_notifications_attempt_count_check check (attempt_count >= 0);

create index if not exists purchase_email_notifications_owner_created_idx
  on public.purchase_email_notifications(owner_id, created_at desc);

alter table public.purchase_email_notifications enable row level security;
revoke all on public.purchase_email_notifications from anon, authenticated;

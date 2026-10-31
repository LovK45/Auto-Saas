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
alter table public.purchase_email_notifications enable row level security;
revoke all on public.purchase_email_notifications from anon, authenticated;

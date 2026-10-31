-- Product display metadata and seller-managed private delivery configuration.
alter table public.stripe_products
  add column if not exists product_name text,
  add column if not exists product_description text;

alter table public.purchase_entitlements
  add column if not exists product_name text,
  add column if not exists product_description text;

-- Backfill metadata where possible from already-recorded purchases.
update public.purchase_entitlements e
set product_name = coalesce(e.product_name, p.product_key),
    product_description = coalesce(e.product_description, '')
from public.purchases p
where p.stripe_checkout_session_id = e.stripe_checkout_session_id;

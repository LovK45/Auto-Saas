-- Opaque public identifiers for shareable product checkout pages.
alter table public.stripe_products
  add column if not exists public_checkout_key uuid not null default gen_random_uuid();
create unique index if not exists stripe_products_public_checkout_key_uidx
  on public.stripe_products(public_checkout_key);

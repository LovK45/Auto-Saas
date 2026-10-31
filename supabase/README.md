# Supabase backend setup

This repository's frontend is hosted as static files. The schema in `schema.sql` is a database foundation only; it does not provision a Supabase project or connect the current browser dashboard automatically.

## Configure Supabase
1. Create a Supabase project.
2. Run `schema.sql` in the Supabase SQL Editor.
3. Configure Supabase Auth and allow the exact deployed site origin in redirect settings.
4. Keep the service-role key private. Never put it in `index.html`, `app.js`, GitHub Pages, or any public repository file.

## Security model
The tables use Supabase Row Level Security and `auth.uid()` owner checks. Purchases are readable by their owner, but the browser must not be allowed to write purchase rows. A verified Stripe webhook should be the only writer. Do not grant access based on a checkout success URL or a client-side flag.

## Frontend authentication status
The Connections screen loads the Supabase JS v2 browser client and supports email/password account creation and sign-in. The public anon key is intended for browser use with correctly configured Row Level Security. Configure the deployed site URL and email-confirmation redirect URLs in Supabase Auth. If email confirmation is enabled, users must confirm before signing in. The app reports connection/session state but does not claim cloud synchronization.

## Still required before production
- Deploy authenticated Edge Functions for AI generation and checkout creation.
- Deploy a Stripe webhook that verifies the raw request signature and records paid sessions idempotently.
- Supabase email/password sign-up, sign-in, session persistence and sign-out controls are now present in the frontend. Configure the project URL and public anon key in Connections.
- Database CRUD/cloud sync is not yet connected; campaigns, leads, drafts and partner links still use browser localStorage. Do not treat authentication alone as cloud backup.
- Add per-user AI quotas, request throttling, spend limits, monitoring, backups, and abuse protection.
- Add an email delivery provider and social publishing APIs only after consent, unsubscribe, account authorization, and provider review flows are implemented.

No provider is live merely because this folder exists. Use Stripe test mode and verify webhook events before accepting real payments. Traffic and revenue are not guaranteed.

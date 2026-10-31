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
The Connections screen loads the Supabase JS v2 browser client and supports email/password account creation and sign-in. The public anon key is intended for browser use with correctly configured Row Level Security. Configure the deployed site URL and email-confirmation redirect URLs in Supabase Auth. If email confirmation is enabled, users must confirm before signing in. The app reports connection/session state and provides explicit backup/restore actions. Routine edits are not automatically synchronized.

## Still required before production
- Deploy authenticated Edge Functions for AI generation and checkout creation.
- Deploy a Stripe webhook that verifies the raw request signature and records paid sessions idempotently.
- Supabase email/password sign-up, sign-in, session persistence and sign-out controls are now present in the frontend. Configure the project URL and public anon key in Connections.
- The Connections screen now offers explicit cloud backup and restore using `workspace_snapshots`. The snapshot is private to the signed-in user through RLS. Back up local records manually; restore replaces the current browser records after confirmation. Routine CRUD still runs locally between backups, so this is manual snapshot sync rather than live multi-device synchronization.
- Add per-user AI quotas, request throttling, spend limits, monitoring, backups, and abuse protection.
- Add an email delivery provider and social publishing APIs only after consent, unsubscribe, account authorization, and provider review flows are implemented.

No provider is live merely because this folder exists. Use Stripe test mode and verify webhook events before accepting real payments. Traffic and revenue are not guaranteed.


## Current CRM and email sequence scope

- The browser-local CRM supports contact search, status filtering, tag filtering, editable status/tags/internal notes, and CSV export of those fields.
- The sequence planner saves a trigger label and up to two drafted email steps with a configured delay. It is a planning tool only: there is no enrollment engine, scheduler, delivery provider, unsubscribe processor, or send tracking yet.
- CRM records and sequence plans are included in manual workspace snapshot backups. This is not automatic row-level cloud sync.


## Visual automation designer scope

- Workflow definitions are stored in the browser workspace with a trigger label, optional contact condition, ordered action steps, and optional per-step delay metadata.
- Users can mark a workflow as ready or pause it. This is a local readiness flag only; it does not register a server-side trigger or execute actions.
- The test bench evaluates the selected contact condition locally and writes an explicitly labelled simulation record. It does not modify contacts, send email, create tasks, wait for delays, or call external services.
- Workflow definitions and simulation history are included in manual workspace snapshots. A production execution service still needs authenticated server-side event intake, durable job storage, a scheduler/queue, idempotency, retry handling, audit logs and provider integrations.


## Local workflow event bridge

Enabled workflows now listen to two supported browser-local events: creation of a permission-confirmed lead and addition of a contact tag. Conditions are evaluated against that contact. Zero-delay actions can add a contact tag, create a local follow-up task, create a local email draft, record workspace activity, or create a local admin notification. These actions run only in the active browser session and are not a distributed automation service. Steps with a configured delay are recorded as pending and are not executed because there is no scheduler. Purchase and campaign triggers remain design-only until trusted server-side event sources are integrated. The browser must not be treated as a secure source of payment events.


## Tasks and notification inbox

- The Tasks & Alerts workspace view supports local task creation, optional CRM contact association, due dates, priority, notes, completion/reopening, filtering and deletion.
- The notification inbox supports unread counts, mark-one-read, mark-all-read and clearing read or individual alerts.
- Tasks and notifications created by enabled local workflow actions appear in these views. Records remain browser-local and are included in manual workspace snapshots; they are not cross-device synchronized except through manual snapshot backup/restore.
- Due-date overdue counts use the browser's current date. No background reminders or push notifications are scheduled.


## Content calendar

- The Content Calendar stores planned content with title, date, platform, content type and a caption/production brief.
- Entries can be filtered, marked published/reopened, copied as text, deleted and exported as CSV. Published status is user-managed and is not verified against a social platform.
- This module is a planning queue only. It does not publish, schedule posts with providers, upload media, or send email. Calendar data is included in manual workspace snapshots; no automatic cloud sync is implemented.


## Unified business timeline

The Business Timeline derives a chronological activity view from existing local activity records, lead creation timestamps, task creation/completion timestamps, content calendar creation timestamps, notifications and workflow history. It supports category filtering, text search and CSV export. It does not create a separate audit database, guarantee immutable audit history, or add events retroactively where source records lack timestamps. It remains browser-local and is included in the existing manual workspace snapshot through its source records.


## Campaign performance reporting

Campaign performance stores manually entered reporting snapshots on each local campaign: impressions, clicks, conversions, ad spend, recorded revenue, and a source/period note. The dashboard calculates click-through rate, conversion rate, cost per conversion and return on ad spend, plus aggregate totals and CSV export. Values are user-entered and are not imported from ad networks, analytics providers or payment processors. Recorded revenue is not verified payment data. This module does not claim attribution accuracy and does not count general affiliate clicks as campaign clicks. Performance snapshots are included in campaign objects in the existing manual workspace backup.


## First-party UTM lead attribution

The lead form has a separate, unchecked attribution-consent control; it is distinct from permission to store/contact the person. When the operator confirms that separate consent, a new lead can retain the first-touch UTM source, medium, campaign, content and term values from the current browser session. The first-touch values are held in session storage and are not refreshed on subsequent tagged page visits in that session. The Campaign Performance view groups consented attributed leads by source/medium/campaign. These are lead counts only, not purchases or verified revenue. No fingerprinting, third-party analytics tags, cross-device stitching or ad-network import is performed. Attribution is available only when the visitor arrives with UTM parameters and the lead is entered in the same browser session. Existing leads are not retroactively attributed. UTM values are user-controlled and can be inaccurate. The workspace remains browser-local until the user manually backs up to Supabase; lead attribution fields are included in that snapshot because they are part of each lead record.

The left feature navigation is independently scrollable on desktop and mobile; the workspace footer remains visible while the feature list scrolls.


## Lead outcome tracking

CRM users can manually mark a lead as converted or undo that mark. Conversion timestamps and the explicit `manual_lead_conversion` type are saved on the lead record, included in CSV exports and manual workspace snapshots, and shown as a separate count in the consented UTM attribution report. These marks are operator-entered lead outcomes only; they do not create purchase records, verify Stripe payments, add revenue, or alter campaign performance revenue/ROAS. The business timeline records conversion marks. New lead creation timestamps are recorded for timeline reporting.


## Verified Stripe purchase ledger (Edge Function)

The repository now includes a signed-webhook handler at `functions/stripe-webhook/index.ts` and an additive migration at `migrations/20261031_verified_stripe_purchases.sql`.

### Required deployment sequence
1. Apply the original `schema.sql` if it has not already been applied.
2. Apply `migrations/20261031_verified_stripe_purchases.sql` in the Supabase SQL Editor.
3. Deploy the Edge Function from this repository folder:
   `supabase functions deploy stripe-webhook --no-verify-jwt`
4. Set function secrets in Supabase (never in the frontend or GitHub Pages):
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. In Stripe test mode, create a webhook endpoint pointing to the deployed function URL. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `charge.refunded`. Copy the endpoint signing secret into `STRIPE_WEBHOOK_SECRET`.
6. Send test events and verify rows/statuses in the Supabase database before switching any real payment flow on.

### Checkout metadata contract
A trusted checkout-creation endpoint must set these Stripe Checkout Session metadata fields: `owner_id`, `workspace_id`, and `product_key`. The webhook checks that the workspace belongs to the stated authenticated owner before recording a session. Do not let an untrusted browser choose arbitrary owner metadata; the checkout-creation endpoint must derive owner identity from the verified Supabase access token and validate workspace ownership. Existing manually pasted Stripe Payment Links are not automatically connected to this ledger and may not supply the required metadata.

### Security and scope
- The handler verifies the exact raw request body with Stripe's signature before reading event data.
- Event IDs are reserved to prevent duplicate processing; failed processing releases the reservation so Stripe retries can be handled.
- Purchase rows are written with the Supabase service-role key inside the Edge Function only. Browser roles retain owner-scoped read access and cannot write purchases.
- Checkout sessions are recorded as paid only when Stripe reports `payment_status=paid`; asynchronous failures are recorded as failed. Refund events update the linked payment intent and refunded amount.
- The current static app does not yet create trusted Checkout Sessions, display a live verified-sales dashboard, grant customer entitlements, or reconcile disputes/chargebacks. Do not treat a payment-link redirect, local conversion mark, or client-side flag as proof of payment.
- Test the webhook and confirm owner/workspace isolation before production use. This code has been structurally reviewed here but not deployed against a live Supabase or Stripe account.


## Authenticated one-time Checkout creation

A second Edge Function now lives at `functions/create-checkout/index.ts`. It requires a valid Supabase user session, confirms that the requested workspace belongs to that user, and looks up a server-managed Stripe Price ID. The browser cannot send an amount or redirect URL to override the configured price or return destination.

### Additional setup
1. Apply `migrations/20261031_stripe_product_catalog.sql` after the verified-purchases migration.
2. Deploy with `supabase functions deploy create-checkout` (JWT verification remains enabled).
3. Set Edge Function secrets: `STRIPE_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `APP_BASE_URL` (the exact HTTPS origin of the deployed static app).
4. Insert one `stripe_products` row per sellable item using the authenticated owner's workspace ID, a stable `product_key`, the Stripe Price ID created in Stripe Dashboard, and `active=true`. The table has no browser grants or policies; manage it through trusted admin tooling or the Supabase SQL Editor.
5. The signed webhook described above must also be deployed and configured. Checkout metadata is populated by this function and validated again by the webhook.

The frontend is not yet wired to call this function, and the static local product catalog does not provision Stripe Prices or rows in `stripe_products`. Do not assume checkout is available until the database migrations, secrets, Stripe Price records, both Edge Functions, and webhook endpoint are configured and tested in Stripe test mode. Do not switch to live mode until successful, failed, duplicate, and refund test cases have been verified.


## Verified sales dashboard and checkout UI

The Products & Sales screen now loads the authenticated owner's purchase ledger from Supabase after sign-in and refresh. It displays verified paid order count, gross amount, refunded amount, net paid amount, and the latest 250 purchase records with customer email, product key, payment state, amounts, and timestamps. Totals are grouped by currency rather than incorrectly adding unlike currencies together.

The screen can create the owner's first workspace if needed, display the workspace/owner IDs for trusted product-catalog setup, and invoke the authenticated `create-checkout` Edge Function for a local catalog item. The local item's numeric ID is used as its `product_key`; a matching active `stripe_products` row and Stripe Price ID must be inserted by an administrator. Checkout remains unavailable until both functions, both migrations, secrets, and Stripe webhook configuration are deployed. The dashboard is not live until Supabase is configured and the user signs in. No customer entitlement or digital delivery is automatically provisioned.

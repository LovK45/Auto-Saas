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

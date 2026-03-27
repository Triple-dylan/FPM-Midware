# CLAUDE.md — FPM DataTool

## What This Project Is

A Node/TypeScript integration service ("sync engine") for Full Package Media that unifies lead and order data across four systems:

- **Go High Level (GHL)** — CRM, owns contact lifecycle and rep assignment
- **Zendesk Support** — support ticket context
- **Zendesk Sell** — legacy CRM, migration source only (data moves out, nothing moves in)
- **Aryeo** — real estate media orders (**read-only from our side**: ingest into Postgres; never remove or change records in Aryeo)

All data flows into a **canonical PostgreSQL database** (hosting provider TBD) keyed on an internal `lead_id`. The service syncs bidirectionally with GHL and Zendesk Support, ingests orders from Aryeo (without mutating Aryeo data), and migrates historical data out of Zendesk Sell.

### Current product priority

1. **Aryeo → Postgres → GHL** — read orders from Aryeo (webhooks/API, read-only in Aryeo), store canonically, then **update GHL contacts** when toggles and field mapping allow (e.g. order summary custom fields). Requires a linked GHL contact on the lead (`lead_external_ids` for `ghl`).
2. **Zendesk Support** — stay in sync with Support for tickets/users as needed.
3. **Zendesk Sell** — large migration is a **separate phase** later; keep toggles/off until you run that project.

### Automation admin UI

- **`GET /admin`** — browser UI to enable/disable pipeline steps (`automation_toggles` in Postgres).
- **`GET` / `PUT /api/automations`** — JSON API for the same (optional `SYNC_ADMIN_TOKEN` as `Authorization: Bearer …`).
- **GHL field targets** — table `ghl_field_map`; import your CSV with `npm run import:ghl-fields -- path/to.csv` (see `config/ghl-field-map.example.csv`).
- Outbound GHL calls use **`GHL_ACCESS_TOKEN`** (see `.env.example`).

## Key Design Decisions

- **Internal `lead_id` is the single source of truth.** Every record links back to it; never use external system IDs as primary keys.
- **Log everything.** Every sync, webhook, migration step, and dedup decision should be auditable.
- **Matching/dedup priority:** email → phone → name + company.
- **GHL is authoritative for ownership** (rep + team assignment). Other systems defer to it.
- **Aryeo is not mutated by this service.** No deletes, updates, or other writes that change or remove data in Aryeo; only read webhooks/APIs and replicate state into PostgreSQL. If a future feature needs outbound Aryeo actions, it requires explicit product sign-off and separation from core sync.

## Tech Stack

- **Runtime:** Node.js / TypeScript
- **Database:** PostgreSQL (hosting/provider TBD)
- **Integrations:** Webhook-driven (GHL contact events, Zendesk ticket/user events, Aryeo activity events) + REST reads as needed (**Aryeo:** read-only; no destructive or in-place updates in Aryeo)

## Implementation Phases

| Phase | Focus |
|-------|-------|
| 0 | Schema + field mapping |
| 1 | Identity layer + DB setup |
| 2 | Zendesk Sell migration |
| 3 | GHL ↔ Zendesk Support sync |
| 4 | Aryeo order sync |
| 5 | Commission tracking layer |
| 6 | Stale account detection → GHL tasks |
| 7 | Hardening (retries, idempotency, monitoring) |

## Project Docs

- `PRD.md` — product requirements and system roles
- `IMPLEMENTATION_AND_TESTING.md` — phased plan and testing strategy
- `API_AND_WEBHOOK_PAYLOADS.md` — webhook payload shapes and matching logic

## Development Guidelines

- Always prefer editing existing files over creating new ones.
- Keep sync logic idempotent — replaying a webhook should not create duplicates.
- Write tests alongside implementation: unit tests for normalization/matching, integration tests for webhook handling, and migration tests for batch validation.
- When adding a new integration endpoint, update `API_AND_WEBHOOK_PAYLOADS.md` with the actual payload shape.

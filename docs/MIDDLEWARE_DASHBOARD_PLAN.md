# Middleware dashboard & live operations (plan)

This document frames the next layer on top of the sync engine: **provenance**, **directed transfers**, **reporting**, and a **dashboard**—developed alongside the live deployment.

## Goals

| Area | Intent |
|------|--------|
| **Data provenance** | For any lead or order, show *which system* wrote what, when (`sync_events`, `orders.raw_payload`, `lead_external_ids`). |
| **Directed lead transfers** | Controlled workflows to hand off or reassign a lead (GHL + internal rules), with audit rows—not ad-hoc API edits. |
| **Reporting** | Cohort metrics, pipeline health, webhook failure rates, time-to-sync. |
| **Dashboard** | One place to see activity: inbound events, order upserts, GHL outbound results. |

## Phasing (suggested)

1. **Live monitor (now)** — Read-only view of recent `sync_events` + `orders` (with lead email), auto-refresh. Validates webhooks + DB + outbound while you pilot.
2. **Provenance drill-down** — Lead/order detail page: timeline of `sync_events`, external IDs, last payload hash or size (not full raw in browser by default).
3. **Reporting v1** — SQL views or materialized summaries: orders per day, leads touched, error counts by `sync_events.action = 'error'`.
4. **Transfers** — Schema + API for “transfer request” (from rep/team → to rep/team) with states + GHL calls + logging.

## Tech direction

- **Same Node service** serves JSON APIs + small server-rendered HTML (as with `/admin`) until a dedicated SPA is justified.
- **Auth** — Reuse `SYNC_ADMIN_TOKEN` (Bearer) for operator routes; later SSO or API keys per role.
- **Real-time** — Start with **polling** (`/api/monitor/feed`); add **SSE** or **WebSocket** if refresh latency matters.
- **Hosting** — Dashboard sits behind HTTPS reverse proxy; token never in URLs.

## Related routes (initial)

| Route | Purpose |
|-------|---------|
| `GET /dashboard` | HTML ops dashboard (metrics + tables; polls feed). |
| `GET /monitor` | Same page as `/dashboard` (alias). |
| `GET /api/dashboard/feed?limit=…` | JSON: `middleware`, `refresh_interval_ms`, `metrics`, `automations` (id, label, enabled), `sync_events`, `orders`. |
| `GET /api/monitor/feed` | Same JSON as dashboard feed (backward compatible alias). |

Extend this table as features ship.

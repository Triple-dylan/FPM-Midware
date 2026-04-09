# Phase 1 — Operational rules

This document captures **dedup/merge semantics** and the **GHL ↔ Zendesk Support conflict matrix** for the sync engine. Canonical field mappings stay in `schema/field-mappings.md`.

## Project layout (Phase 1 scaffold)

| Path | Purpose |
|------|---------|
| `src/index.ts` | HTTP entry (health endpoint; webhook routes later) |
| `src/config.ts` | Environment/config |
| `src/db/pool.ts` | PostgreSQL pool + `SELECT 1` check |
| `src/http/server.ts` | Minimal `http` server |
| `scripts/apply-schema.ts` | Runs `schema/schema.sql` + `schema/migrations/*.sql` via `pg` (no `psql` binary required) |
| `scripts/bootstrap-local-postgres.ts` | Local dev: create `DATABASE_URL` role + database via superuser (Homebrew Postgres) |
| `vitest.config.ts` | Unit tests |

Commands: `npm install`, `npm run dev`, `npm run build && npm start`, `npm test`, `npm run db:local:bootstrap` (first time), `npm run db:apply`.

---

## Matching priority (before merge)

When linking an external record to a lead, use the same priority as `CLAUDE.md`: **email → phone → name + company**. Store weaker matches as `dedup_candidates` for human or policy-driven resolution.

---

## Dedup candidates: canonical ordering

`dedup_candidates` has `UNIQUE (lead_id_a, lead_id_b)`. The application **must** insert pairs in **canonical order** so `(A, B)` and `(B, A)` never both appear:

- Define `lead_id_lo = min(a, b)` and `lead_id_hi = max(a, b)` (UUID lexical sort as strings is consistent and portable).
- Always store `lead_id_a = lo`, `lead_id_b = hi`.
- `match_reason` and `confidence` describe why the pair was flagged.

---

## Merge resolution (when two leads are the same person)

Assume survivor **`S`** and duplicate **`D`** after review (`resolution = merged`).

1. **External IDs** — Move all `lead_external_ids` rows from `D` to `S`. On `(system, external_id)` conflict with an existing row for `S`, drop the row for `D` and log a `sync_events` entry (`action`: `error` or `skipped`) with details; never silently duplicate keys.
2. **Assignments** — Repoint `lead_assignments.lead_id` from `D` to `S`, or delete `D`’s rows after copying history if you need an audit trail. Enforce **at most one** `is_current = true` per lead in the same transaction.
3. **Orders, tickets, deals, commissions** — Update `lead_id` foreign keys from `D` to `S`.
4. **Dedup rows** — Resolve or delete candidate rows involving `D`; re-run a query to merge any candidates that collapse to the same pair involving `S`.
5. **Survivor profile** — Apply field-level rules below (GHL-wins vs fill-if-null) in one transaction so the merged lead is internally consistent.
6. **Duplicate lead** — Set `D.is_deleted = true` (soft delete). Do not hard-delete `D` if you need FK history; prefer soft delete per schema comments.

Every merge should emit `sync_events` with `action` appropriate to the step (`matched`, `updated`, `error`, etc.) and enough `details` to replay/debug.

---

## GHL ↔ Zendesk Support conflict matrix (`leads`)

When the same `lead_id` is linked to both GHL and Zendesk Support, updates may disagree. **GHL is authoritative for ownership** (`lead_assignments`); Zendesk never writes assignment.

| Area | Winner | Rule |
|------|--------|------|
| **Rep / team** | GHL | Zendesk Support does not map into `lead_assignments`. |
| **Email / phone (identity)** | GHL | If GHL sends a non-empty value, it overwrites `leads.email` / `leads.phone`. Zendesk may only fill when canonical is null (ingestion from ZD-first flows). |
| **Name** | GHL | Prefer `first_name` / `last_name` from GHL when present. Zendesk `name` split may **fill** missing name parts only. |
| **Company, address, website, source, DOB, DND** | GHL | Zendesk Support user object does not own these; if ever populated from ZD side, treat as fill-if-null only. |
| **Notes** | Merge carefully | If GHL `notes` is empty and ZD `notes` is not, append or set with a delimiter and attribution in `sync_events.details` (avoid blind overwrite if both non-empty without review). |
| **Timezone** | GHL wins if set; else ZD | Map ZD `time_zone` to IANA only when GHL `timezone` is null. |
| **Tags** | Union (dedupe) | Merge string arrays, sorted unique; log if large drift. Alternative policy: GHL replaces if GHL tag webhook fired more recently — pick one policy per deployment and document in `sync_events`. |
| **`created_at` / `updated_at`** | Preserved + enriched | Per `field-mappings.md`: Zendesk must not overwrite `created_at`/`updated_at` when a GHL-backed record already exists; maintain `updated_at` from the sync engine when canonical row changes. |

**Tickets** — Zendesk is authoritative for ticket fields stored in `tickets`; linkage is via requester → `lead_id` only.

---

## Idempotency (preview)

Webhook handlers should key work by external id + event id or payload hash (platform-dependent) so retries do not duplicate work. Record processed keys or rely on `UNIQUE` constraints plus upserts; log duplicates in `sync_events`.

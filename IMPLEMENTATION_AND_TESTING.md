# Implementation & Testing

## Phase 0
Schema + mapping

## Phase 1
Identity layer + DB

## Phase 2
Zendesk Sell migration

## Phase 3
GHL ↔ Zendesk Support sync

## Phase 4
Aryeo sync

## Phase 5
Commission layer

## Phase 6
Stale detection

## Phase 7
Hardening

## Testing
- Unit: normalization
- Integration: sync/webhooks
- Migration: batch validation
- Deduplication: matching logic
- E2E: full lifecycle

## Rules
- Always use internal lead_id
- Log everything

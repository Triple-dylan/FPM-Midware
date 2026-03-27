# Full Package Media — Unified Lead & Order System (PRD)

## Date
2026-03-25

## Systems
- Go High Level (GHL)
- Zendesk Support
- Zendesk Sell (Legacy - Migration Only)
- Aryeo

## Objective
Unify lead data, sync orders, eliminate duplicates, and enable commission + lifecycle visibility.

## System Roles
GHL = ownership & lifecycle  
Aryeo = orders  
Zendesk Support = support context  
Zendesk Sell = migration source

## Core Requirements
- Ownership (rep + team)
- Commission tracking (lead/team/timeframe)
- Full historical reconciliation
- Duplicate resolution
- Stale account detection → task in GHL

## Architecture
- Node/TypeScript integration service
- PostgreSQL canonical DB (hosting provider TBD)

## Webhooks
GHL: contact create/update  
Zendesk: ticket + user events  
Aryeo: order + client events  

## Migration Strategy
Extract → Normalize → Match → Deduplicate → Review → Insert into GHL

## Deliverables
- Canonical DB
- Sync engine
- Migration pipeline

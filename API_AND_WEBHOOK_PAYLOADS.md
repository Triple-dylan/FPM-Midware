# API & Webhook Payloads

Reference for all external system APIs used by the sync engine.
Sources: official API documentation for each platform.

---

## GHL (Go High Level)

**Base URL:** `https://services.leadconnectorhq.com`
**Auth:** Bearer token (OAuth2). Header: `Version: 2021-07-28`

### Contact Object (key fields)

```json
{
  "id": "nmFmQEsNgz6AVpgLVUJ0",
  "locationId": "ve9EPM428h8vShlRW1KT",
  "firstName": "Jane",
  "lastName": "Smith",
  "name": "Jane Smith",
  "email": "jane@example.com",
  "phone": "+12065550100",
  "companyName": "Acme Realty",
  "businessName": "Acme Realty LLC",
  "address1": "123 Main St",
  "city": "Seattle",
  "state": "WA",
  "postalCode": "98101",
  "country": "US",
  "website": "https://acmerealty.com",
  "source": "Website Form",
  "timezone": "America/Los_Angeles",
  "dateOfBirth": "1985-06-15T00:00:00.000Z",
  "dateAdded": "2024-01-10T09:00:00.000Z",
  "dateUpdated": "2024-03-01T14:23:00.000Z",
  "assignedTo": "userId123",
  "tags": ["buyer", "vip"],
  "dnd": false,
  "dndSettings": {
    "SMS":      { "status": "inactive", "message": "", "code": "" },
    "Call":     { "status": "inactive", "message": "", "code": "" },
    "Email":    { "status": "active",   "message": "", "code": "" },
    "WhatsApp": { "status": "active",   "message": "", "code": "" },
    "GMB":      { "status": "active",   "message": "", "code": "" },
    "FB":       { "status": "active",   "message": "", "code": "" }
  },
  "customFields": [
    { "id": "BcdmQEsNgz6AVpgLVUJ0", "value": "Custom value" }
  ],
  "additionalEmails": [],
  "additionalPhones": []
}
```

### Webhook Payloads

All contact webhook payloads are flat (no `data` wrapper) and contain a full contact snapshot.

#### ContactCreate / ContactUpdate

```json
{
  "type": "ContactCreate",
  "locationId": "ve9EPM428h8vShlRW1KT",
  "id": "nmFmQEsNgz6AVpgLVUJ0",
  "firstName": "Jane",
  "lastName": "Smith",
  "name": "Jane Smith",
  "email": "jane@example.com",
  "phone": "+12065550100",
  "companyName": "Acme Realty",
  "address1": "123 Main St",
  "city": "Seattle",
  "state": "WA",
  "postalCode": "98101",
  "country": "US",
  "website": "https://acmerealty.com",
  "source": "Website Form",
  "dateAdded": "2024-01-10T09:00:00.000Z",
  "dateOfBirth": "1985-06-15T00:00:00.000Z",
  "dnd": false,
  "tags": ["buyer"],
  "attachments": [],
  "assignedTo": "userId123",
  "customFields": [
    { "id": "BcdmQEsNgz6AVpgLVUJ0", "value": "Custom value" }
  ]
}
```

`ContactUpdate` is identical with `"type": "ContactUpdate"`.
`ContactDelete` is identical with `"type": "ContactDelete"`.
`ContactTagUpdate` fires when tags change, same shape.

#### ContactDndUpdate

```json
{
  "type": "ContactDndUpdate",
  "id": "nmFmQEsNgz6AVpgLVUJ0",
  "dnd": true,
  "dndSettings": {
    "SMS":      { "status": "active", "message": "", "code": "" },
    "Call":     { "status": "active", "message": "", "code": "" },
    "Email":    { "status": "inactive", "message": "", "code": "" },
    "WhatsApp": { "status": "active",  "message": "", "code": "" },
    "GMB":      { "status": "active",  "message": "", "code": "" },
    "FB":       { "status": "active",  "message": "", "code": "" }
  }
}
```

### Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST   | `/contacts/` | Create contact |
| GET    | `/contacts/{id}` | Get contact |
| PUT    | `/contacts/{id}` | Update contact (tags overwrite — use tag endpoints for incremental) |
| POST   | `/contacts/upsert` | Upsert by email/phone |
| POST   | `/contacts/search` | Advanced search |
| GET    | `/contacts/search/duplicate` | Find duplicate |
| POST   | `/contacts/{id}/tags` | Add tags |
| DELETE | `/contacts/{id}/tags` | Remove tags |
| POST   | `/contacts/{id}/tasks` | Create stale-detection task |

---

## Zendesk Support

**Base URL:** `https://{subdomain}.zendesk.com`
**Auth:** Basic (email/token) or OAuth2

### User Object (key fields)

```json
{
  "id": 12345678,
  "name": "Jane Smith",
  "email": "jane@example.com",
  "phone": "+12065550100",
  "organization_id": 98765,
  "external_id": "nmFmQEsNgz6AVpgLVUJ0",
  "tags": ["buyer"],
  "notes": "VIP client referred by broker",
  "details": "Additional details here",
  "time_zone": "Pacific Time (US & Canada)",
  "iana_time_zone": "America/Los_Angeles",
  "role": "end-user",
  "verified": true,
  "suspended": false,
  "created_at": "2024-01-10T09:00:00Z",
  "updated_at": "2024-03-01T14:23:00Z",
  "user_fields": {}
}
```

### Ticket Object (key fields)

```json
{
  "id": 456789,
  "subject": "Issue with listing photos",
  "description": "The delivered photos are missing the backyard.",
  "status": "open",
  "priority": "normal",
  "type": "question",
  "requester_id": 12345678,
  "assignee_id": 11111,
  "group_id": 22222,
  "organization_id": 98765,
  "tags": ["photos", "delivery"],
  "via": { "channel": "email" },
  "created_at": "2024-03-05T10:00:00Z",
  "updated_at": "2024-03-06T08:30:00Z"
}
```

### Webhook Payload Envelope (all events)

```json
{
  "account_id": 12345,
  "id": "unique-event-uuid",
  "time": "2024-03-05T10:00:00Z",
  "type": "zen:event-type:ticket.status_changed",
  "zendesk_event_version": "2022-06-20",
  "subject": "zen:user:12345678/ticket:456789",
  "detail": {
    "id": 456789,
    "status": "open",
    "requester_id": 12345678,
    "assignee_id": 11111,
    "group_id": 22222,
    "subject": "Issue with listing photos",
    "tags": ["photos"],
    "created_at": "2024-03-05T10:00:00Z",
    "updated_at": "2024-03-06T08:30:00Z"
  },
  "event": {
    "current": "open",
    "previous": "new"
  }
}
```

### Webhook Event Types (subscribed events)

**Ticket:** `ticket.created`, `ticket.status_changed`, `ticket.agent_assignment_changed`,
`ticket.comment_added`, `ticket.tags_changed`

**User:** `user.created`, `user.name_changed`, `user.external_id_changed`

### Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/v2/users/{id}` | Get user |
| GET    | `/api/v2/tickets/{id}` | Get ticket |
| GET    | `/api/v2/incremental/users/cursor` | Bulk user export (migration) |
| GET    | `/api/v2/incremental/tickets/cursor` | Bulk ticket export |

---

## Zendesk Sell (Migration Only)

**Base URL:** `https://api.getbase.com`
**Auth:** OAuth2 Bearer token

### Lead Object (key fields)

```json
{
  "id": 7654321,
  "first_name": "Jane",
  "last_name": "Smith",
  "organization_name": "Acme Realty",
  "title": "Agent",
  "email": "jane@example.com",
  "phone": "206-555-0100",
  "mobile": "206-555-0199",
  "website": "https://acmerealty.com",
  "address": {
    "street": "123 Main St",
    "city": "Seattle",
    "state": "WA",
    "postal_code": "98101",
    "country": "US"
  },
  "status": "New",
  "source_id": 5,
  "tags": ["buyer"],
  "description": "Referred by broker",
  "custom_fields": {},
  "owner_id": 111,
  "creator_id": 222,
  "created_at": "2023-06-01T00:00:00Z",
  "updated_at": "2023-12-15T00:00:00Z"
}
```

### Contact Object — Individual (key fields)

```json
{
  "id": 1234567,
  "is_organization": false,
  "contact_id": 9999,
  "first_name": "Jane",
  "last_name": "Smith",
  "title": "Agent",
  "email": "jane@example.com",
  "phone": "206-555-0100",
  "mobile": "206-555-0199",
  "website": "https://acmerealty.com",
  "address": {
    "street": "123 Main St",
    "city": "Seattle",
    "state": "WA",
    "postal_code": "98101",
    "country": "US"
  },
  "customer_status": "current",
  "prospect_status": "current",
  "tags": ["buyer"],
  "custom_fields": {},
  "owner_id": 111,
  "created_at": "2023-01-15T00:00:00Z",
  "updated_at": "2023-11-20T00:00:00Z"
}
```

### Contact Object — Organization (`is_organization: true`) → maps to `companies`

```json
{
  "id": 9999,
  "is_organization": true,
  "name": "Acme Realty",
  "email": "info@acmerealty.com",
  "phone": "206-555-0000",
  "website": "https://acmerealty.com",
  "industry": "Real Estate",
  "address": {
    "street": "100 Brokerage Ave",
    "city": "Seattle",
    "state": "WA",
    "postal_code": "98101",
    "country": "US"
  },
  "tags": [],
  "custom_fields": {},
  "created_at": "2022-06-01T00:00:00Z",
  "updated_at": "2023-10-01T00:00:00Z"
}
```

### Deal Object (key fields)

```json
{
  "id": 555444,
  "name": "Jane Smith — Listing Package",
  "value": 45000,
  "currency": "USD",
  "hot": false,
  "stage_id": 12,
  "contact_id": 1234567,
  "estimated_close_date": "2024-02-01",
  "last_stage_change_at": "2023-12-01T00:00:00Z",
  "last_activity_at": "2024-01-15T00:00:00Z",
  "source_id": 5,
  "loss_reason_id": null,
  "tags": [],
  "custom_fields": {},
  "owner_id": 111,
  "created_at": "2023-11-01T00:00:00Z",
  "updated_at": "2024-01-15T00:00:00Z"
}
```

### Bulk Export Strategy

Use the Sync API for full migration:

```
POST /v2/sync/start        { "device_uuid": "<persistent-uuid>" }
GET  /v2/sync/{session}/queues/main
POST /v2/sync/ack          { "session_id": "...", "queue": "main", "sequence": 999 }
```

Covers: contacts, deals, leads, users, custom fields. First run delivers full dataset.

---

## Aryeo

**Base URL:** `https://api.aryeo.com/v1`
**Auth:** Bearer token

### Order Object (key fields)

```json
{
  "object": "ORDER",
  "id": "00000000-0000-4000-8000-000000000001",
  "identifier": "Order #42",
  "number": 42,
  "title": "Order #42",
  "order_status": "OPEN",
  "fulfillment_status": "UNFULFILLED",
  "payment_status": "UNPAID",
  "total_amount": 34900,
  "balance_amount": 34900,
  "total_tax_amount": 0,
  "total_discount_amount": 0,
  "currency": "USD",
  "payment_url": "https://...",
  "status_url": "https://...",
  "internal_notes": null,
  "fulfilled_at": null,
  "created_at": "2024-03-01T10:00:00Z",
  "updated_at": "2024-03-01T10:05:00Z",
  "address": {
    "id": "00000000-0000-4000-8000-000000000010",
    "street_number": "123",
    "street_name": "Main St",
    "unit_number": null,
    "city": "Seattle",
    "state_or_province": "WA",
    "postal_code": "98101",
    "country": "US",
    "latitude": 47.6062,
    "longitude": -122.3321
  },
  "customer": {
    "id": "00000000-0000-4000-8000-000000000020",
    "type": "AGENT",
    "name": "Jane Smith",
    "email": "jane@example.com",
    "phone": "206-555-0100",
    "office_name": "Acme Realty",
    "license_number": "WA-12345"
  },
  "items": [
    {
      "id": "00000000-0000-4000-8000-000000000030",
      "title": "Photography Package",
      "purchasable_type": "PRODUCT_VARIANT",
      "unit_price_amount": 34900,
      "quantity": 1,
      "gross_total_amount": 34900,
      "is_canceled": false,
      "is_serviceable": true
    }
  ],
  "tags": []
}
```

### Webhook Payload (Activity object)

All webhooks POST an `Activity` object. The order/customer data is in `resource`.

```json
{
  "object": "ACTIVITY",
  "id": "00000000-0000-4000-8000-000000000099",
  "name": "ORDER_CREATED",
  "title": "Order Created",
  "description": "A new order was placed for 123 Main St, Seattle, WA.",
  "source": "WEB",
  "occurred_at": "2024-03-01T10:00:00Z",
  "system_activity": false,
  "target_url": "https://www.aryeo.com/orders/00000000-0000-4000-8000-000000000001/edit",
  "target_label": "View Order",
  "acting_user": {
    "id": "00000000-0000-4000-8000-000000000050",
    "email": "jane@example.com",
    "first_name": "Jane",
    "last_name": "Smith"
  },
  "acting_group": {
    "id": "00000000-0000-4000-8000-000000000060",
    "type": "CREATOR",
    "name": "Full Package Media"
  },
  "group": {
    "id": "00000000-0000-4000-8000-000000000060",
    "type": "CREATOR",
    "name": "Full Package Media"
  },
  "resource": { }
}
```

**Webhook security:** HMAC-SHA256 of raw body using shared secret, delivered in `Signature` header.
**Retry logic:** 10s after first failure, 100s after second. Three total attempts.

### Webhook Event Names (relevant subset)

**Order:** `ORDER_CREATED`, `ORDER_PLACED`, `ORDER_RECEIVED`, `ORDER_PAYMENT_COMPLETED`,
`ORDER_REFUNDED`, `ORDER_MEDIA_DOWNLOADED`, `ORDER_ATTACHED_TO_LISTING`

**Appointment:** `APPOINTMENT_SCHEDULED`, `APPOINTMENT_RESCHEDULED`, `APPOINTMENT_CANCELED`

**Customer Team:** `CUSTOMER_TEAM_CREATED`, `CUSTOMER_TEAM_MEMBERSHIP_CREATED`

### Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/orders` | List orders (paginated, filterable) |
| POST   | `/orders` | Create order |
| GET    | `/orders/{id}` | Get order |
| GET    | `/customers` | List customers |
| POST   | `/customers` | Create customer |
| GET    | `/customer-users` | List customer users |
| POST   | `/customer-users` | Create customer user |

---

## Matching Logic

When ingesting a record from any system, resolve to an existing lead in this priority order:

1. **Email** (exact, case-insensitive) → high confidence → auto-merge
2. **Phone** (E.164 normalized) → high confidence → auto-merge
3. **First name + Last name + Company name** (fuzzy) → medium/low confidence → flag in `dedup_candidates` for review

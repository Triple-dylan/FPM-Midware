# Field Mappings — External Systems → Canonical Schema

Each section shows how a source system's fields map to the `leads` table (or other canonical tables).
Blank cells in the "Source Field" column mean that field has no equivalent in that system.

---

## 1. GHL → leads

GHL is authoritative for ownership and lifecycle. All contacts sync bidirectionally.

| Canonical Field       | GHL Field          | Notes |
|-----------------------|--------------------|-------|
| `id`                  | —                  | Internal UUID; GHL id stored in `lead_external_ids` |
| `first_name`          | `firstName`        | |
| `last_name`           | `lastName`         | |
| `email`               | `email`            | Case-insensitive match key |
| `phone`               | `phone`            | Normalize to E.164; GHL sends E.164 already |
| `phone_raw`           | `phone`            | Preserve original before normalization |
| `company_name`        | `companyName`      | Also check `businessName` if `companyName` is null |
| `title`               | —                  | Not in GHL contact object |
| `address_line1`       | `address1`         | |
| `city`                | `city`             | |
| `state`               | `state`            | |
| `postal_code`         | `postalCode`       | |
| `country`             | `country`          | ISO 3166 code |
| `website`             | `website`          | |
| `timezone`            | `timezone`         | IANA format |
| `date_of_birth`       | `dateOfBirth`      | ISO 8601 → DATE |
| `source`              | `source`           | |
| `tags`                | `tags`             | Array of strings |
| `dnd`                 | `dnd`              | Boolean |
| `notes`               | —                  | GHL notes are separate sub-resources (`/contacts/{id}/notes`) |
| `created_at`          | `dateAdded`        | |
| `updated_at`          | `dateUpdated`      | |

**GHL-only fields stored in `lead_external_ids.meta`:**
- `locationId` — sub-account identifier

**GHL-only fields stored in `lead_assignments`:**
- `assignedTo` → `rep_id`

**GHL-only fields NOT mapped (stored in raw payload only):**
- `attributionSource`, `lastAttributionSource` — UTM/attribution data
- `dndSettings` — per-channel DND detail
- `additionalEmails`, `additionalPhones`
- `opportunities` — pipeline stages (not mapped yet; revisit Phase 3)
- `customFields` — stored as raw JSONB in `sync_events.details` until custom field taxonomy is defined
- `followers`, `visitorId`, `keyword`, `offers`, `products`

---

## 2. Zendesk Support → leads + tickets

Zendesk Support is read for support context. User records enrich leads; tickets are stored separately.

### 2a. Zendesk Support User → leads

| Canonical Field  | ZD Support Field   | Notes |
|------------------|--------------------|-------|
| `first_name`     | `name` (split)     | ZD Support has a single `name` field; split on first space |
| `last_name`      | `name` (split)     | Remainder after first space |
| `email`          | `email`            | Match key |
| `phone`          | `phone`            | Normalize to E.164 |
| `timezone`       | `time_zone`        | ZD name format (e.g. "Eastern Time") — map to IANA |
| `notes`          | `notes`            | |
| `tags`           | `tags`             | |
| `created_at`     | `created_at`       | Enrich only — do not overwrite if GHL record exists |
| `updated_at`     | `updated_at`       | |

**ZD Support-only fields stored in `lead_external_ids.meta`:**
- `organization_id`
- `external_id` — their cross-reference field (may already contain GHL or Sell ID)

**ZD Support-only fields NOT mapped:**
- `role`, `verified`, `suspended`, `restricted_agent` — agent/admin fields
- `signature`, `moderator`, `two_factor_auth_enabled`
- `user_fields` — custom fields; store in `sync_events.details` for now
- `locale`, `locale_id`

### 2b. Zendesk Support Ticket → tickets

| `tickets` Field        | ZD Support Field       | Notes |
|------------------------|------------------------|-------|
| `zendesk_ticket_id`    | `id`                   | |
| `lead_id`              | `requester_id`         | Resolve via `lead_external_ids` |
| `subject`              | `subject`              | |
| `description`          | `description`          | |
| `status`               | `status`               | new/open/pending/hold/solved/closed |
| `priority`             | `priority`             | urgent/high/normal/low |
| `type`                 | `type`                 | problem/incident/question/task |
| `channel`              | `via.channel`          | |
| `assignee_id`          | `assignee_id`          | |
| `group_id`             | `group_id`             | |
| `organization_id`      | `organization_id`      | |
| `tags`                 | `tags`                 | |
| `created_at`           | `created_at`           | |
| `updated_at`           | `updated_at`           | |
| `raw_payload`          | *(full object)*        | |

---

## 3. Zendesk Sell → leads + companies + sell_deals  (migration only)

Sell data is read-only. After migration, no further writes from Sell.

### 3a. Zendesk Sell Lead → leads

| Canonical Field  | ZD Sell Lead Field     | Notes |
|------------------|------------------------|-------|
| `first_name`     | `first_name`           | |
| `last_name`      | `last_name`            | |
| `email`          | `email`                | Match key |
| `phone`          | `phone`                | Normalize to E.164 |
| `phone_raw`      | `phone`                | |
| `company_name`   | `organization_name`    | |
| `title`          | `title`                | |
| `website`        | `website`              | |
| `address_line1`  | `address.street`       | |
| `city`           | `address.city`         | |
| `state`          | `address.state`        | |
| `postal_code`    | `address.postal_code`  | |
| `country`        | `address.country`      | |
| `source`         | `source_id`            | Resolve source ID to name via Sell API before migration |
| `tags`           | `tags`                 | |
| `notes`          | `description`          | |
| `created_at`     | `created_at`           | |
| `updated_at`     | `updated_at`           | |

**ZD Sell Lead-only fields:**
- `status` — lead status; store in `sync_events.details`
- `custom_fields` — store in `sync_events.details`
- `mobile` — store in `phone_raw` if `phone` is null, else discard
- `twitter`, `facebook`, `linkedin`, `skype` — not mapped; log in details

### 3b. Zendesk Sell Contact (individual) → leads

Same mapping as Sell Lead above, with these differences:

| Canonical Field  | ZD Sell Contact Field  | Notes |
|------------------|------------------------|-------|
| `first_name`     | `first_name`           | |
| `last_name`      | `last_name`            | |
| `email`          | `email`                | |
| `phone`          | `phone`                | |
| `company_name`   | via `contact_id`       | Look up parent org Contact by `contact_id`, use its `name` |
| `title`          | `title`                | |
| `notes`          | `description`          | |

### 3c. Zendesk Sell Contact (organization, `is_organization: true`) → companies

| `companies` Field | ZD Sell Contact Field  | Notes |
|-------------------|------------------------|-------|
| `name`            | `name`                 | |
| `website`         | `website`              | |
| `phone`           | `phone`                | |
| `email`           | `email`                | |
| `industry`        | `industry`             | |
| `address`         | `address`              | Store as JSONB |
| `notes`           | `description`          | |
| `tags`            | `tags`                 | |

### 3d. Zendesk Sell Deal → sell_deals

| `sell_deals` Field       | ZD Sell Deal Field         | Notes |
|--------------------------|----------------------------|-------|
| `sell_deal_id`           | `id`                       | |
| `lead_id`                | `contact_id`               | Resolve to internal lead via `lead_external_ids` |
| `name`                   | `name`                     | |
| `value`                  | `value`                    | Convert to cents; Sell returns int or "X.XX" string |
| `currency`               | `currency`                 | |
| `stage_id`               | `stage_id`                 | |
| `owner_id`               | `owner_id`                 | |
| `estimated_close_date`   | `estimated_close_date`     | |
| `last_stage_change_at`   | `last_stage_change_at`     | |
| `last_activity_at`       | `last_activity_at`         | |
| `tags`                   | `tags`                     | |
| `custom_fields`          | `custom_fields`            | Store as JSONB |
| `sell_created_at`        | `created_at`               | |
| `sell_updated_at`        | `updated_at`               | |
| `raw_payload`            | *(full object)*            | |

---

## 4. Aryeo → leads + orders

Aryeo is authoritative for orders. The `customer` on an order maps to a lead.

### 4a. Aryeo GroupCustomer → leads

| Canonical Field  | Aryeo GroupCustomer Field | Notes |
|------------------|---------------------------|-------|
| `first_name`     | `first_name`              | |
| `last_name`      | `last_name`               | |
| `email`          | `email`                   | Match key |
| `phone`          | `phone` / `phone_number`  | Normalize to E.164 |
| `company_name`   | `agent_company_name`      | Also `name` if `type` is BROKERAGE |
| `license_number` | `agent_license_number`    | |
| `website`        | `website_url`             | |
| `timezone`       | `timezone`                | |
| `notes`          | `internal_notes`          | |
| `created_at`     | `created_at`              | Enrich only |

**Aryeo-only fields stored in `lead_external_ids.meta`:**
- `type` (AGENT / BROKERAGE / CREATOR)
- `office_name`
- `verification_status`
- `customer_team_memberships`

### 4b. Aryeo Order → orders

| `orders` Field           | Aryeo Order Field       | Notes |
|--------------------------|-------------------------|-------|
| `aryeo_order_id`         | `id`                    | UUID |
| `aryeo_identifier`       | `identifier`            | Vanity ID |
| `title`                  | `title`                 | |
| `order_status`           | `order_status`          | DRAFT/OPEN/CANCELED |
| `fulfillment_status`     | `fulfillment_status`    | FULFILLED/UNFULFILLED |
| `payment_status`         | `payment_status`        | PAID/PARTIALLY_PAID/UNPAID |
| `total_amount`           | `total_amount`          | Already in cents |
| `balance_amount`         | `balance_amount`        | |
| `total_tax_amount`       | `total_tax_amount`      | |
| `total_discount_amount`  | `total_discount_amount` | |
| `currency`               | `currency`              | |
| `property_address`       | `address`               | Full Aryeo Address object as JSONB |
| `internal_notes`         | `internal_notes`        | |
| `tags`                   | `tags[].name`           | Extract name strings from Tag objects |
| `fulfilled_at`           | `fulfilled_at`          | |
| `created_at`             | `created_at`            | |
| `updated_at`             | `updated_at`            | |
| `lead_id`                | `customer.id`           | Resolve via `lead_external_ids` (aryeo_customer) |
| `raw_payload`            | *(full object)*         | |

### 4c. Aryeo OrderItem → order_items

| `order_items` Field    | Aryeo OrderItem Field    | Notes |
|------------------------|--------------------------|-------|
| `aryeo_item_id`        | `id`                     | |
| `order_id`             | *(parent order)*         | |
| `title`                | `title`                  | |
| `purchasable_type`     | `purchasable_type`       | PRODUCT_VARIANT/FEE/CUSTOM |
| `unit_price_amount`    | `unit_price_amount`      | Prefer over deprecated `amount` |
| `quantity`             | `quantity`               | |
| `gross_total_amount`   | `gross_total_amount`     | |
| `is_canceled`          | `is_canceled`            | |
| `is_serviceable`       | `is_serviceable`         | |

---

## 5. Matching / Dedup Logic

When ingesting a record from any system, match against existing leads in this order:

1. **Email** (exact, case-insensitive) → high confidence
2. **Phone** (E.164 normalized) → high confidence
3. **First name + Last name + Company name** (fuzzy) → medium/low confidence; flag for review

If a match is found, update the existing lead (merge enrichment) and add the external ID to `lead_external_ids`.
If no match is found, create a new lead.
If multiple potential matches are found, insert into `dedup_candidates` and log in `sync_events`.

---

## 6. Field Priority (conflict resolution)

When the same field exists in multiple systems, GHL wins unless the field is blank in GHL.

| Priority | System           | Rationale |
|----------|------------------|-----------|
| 1        | GHL              | Authoritative for ownership and contact lifecycle |
| 2        | Aryeo            | Most recent transactional contact data |
| 3        | Zendesk Support  | Support context, enrich only |
| 4        | Zendesk Sell     | Historical/migration data only |

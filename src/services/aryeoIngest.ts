import type { PoolClient } from "pg";
import { insertDedupCandidate } from "../db/repos/dedupRepo.js";
import {
  findLeadIdByExternalId,
  upsertLeadExternalId,
} from "../db/repos/externalIdsRepo.js";
import {
  findLeadIdsByEmail,
  findLeadIdsByNameCompany,
  findLeadIdsByPhone,
  insertLeadAryeoCustomer,
  patchLeadFromAryeoCustomer,
} from "../db/repos/leadsRepo.js";
import { replaceOrderItems, upsertAryeoOrder } from "../db/repos/ordersRepo.js";
import { insertSyncEvent } from "../db/repos/syncEventsRepo.js";
import {
  normalizeCompanyName,
  normalizeEmail,
  normalizePersonNamePart,
  normalizePhoneE164,
  parseTimestamptz,
  splitFullName,
} from "../lib/normalize.js";

const ARYEO_CUSTOMER = "aryeo_customer";
const SYSTEM = "aryeo";

export type AryeoIngestOutcome =
  | { handled: false }
  | {
      handled: true;
      activityName: string;
      aryeoOrderId: string;
      orderUuid: string;
      leadId: string | null;
    };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function str(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}

function strArr(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter((v): v is string => typeof v === "string");
}

const ORDER_NAMES = new Set([
  "ORDER_CREATED",
  "ORDER_PLACED",
  "ORDER_RECEIVED",
  "ORDER_PAYMENT_COMPLETED",
  "ORDER_REFUNDED",
  "ORDER_MEDIA_DOWNLOADED",
  "ORDER_ATTACHED_TO_LISTING",
]);

async function resolveLeadForAryeoCustomer(
  client: PoolClient,
  customerId: string | null,
  row: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    phone_raw: string | null;
    company_name: string | null;
    license_number: string | null;
  },
): Promise<{ leadId: string; created: boolean }> {
  if (customerId) {
    const linked = await findLeadIdByExternalId(client, ARYEO_CUSTOMER, customerId);
    if (linked) {
      await patchLeadFromAryeoCustomer(client, linked, {
        company_name: row.company_name,
        license_number: row.license_number,
        phone: row.phone,
        phone_raw: row.phone_raw,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
      });
      return { leadId: linked, created: false };
    }
  }

  if (row.email) {
    const ids = await findLeadIdsByEmail(client, row.email);
    if (ids.length === 1) {
      const leadId = ids[0];
      await patchLeadFromAryeoCustomer(client, leadId, {
        company_name: row.company_name,
        license_number: row.license_number,
        phone: row.phone,
        phone_raw: row.phone_raw,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
      });
      return { leadId, created: false };
    }
  }

  if (row.phone) {
    const ids = await findLeadIdsByPhone(client, row.phone);
    if (ids.length === 1) {
      const leadId = ids[0];
      await patchLeadFromAryeoCustomer(client, leadId, {
        company_name: row.company_name,
        license_number: row.license_number,
        phone: row.phone,
        phone_raw: row.phone_raw,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
      });
      return { leadId, created: false };
    }
  }

  const f = row.first_name ?? "";
  const l = row.last_name ?? "";
  const c = row.company_name ?? "";
  if (f.trim() && l.trim() && c.trim()) {
    const ids = await findLeadIdsByNameCompany(client, f, l, c);
    if (ids.length === 1) {
      const leadId = ids[0];
      await patchLeadFromAryeoCustomer(client, leadId, {
        company_name: row.company_name,
        license_number: row.license_number,
        phone: row.phone,
        phone_raw: row.phone_raw,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
      });
      return { leadId, created: false };
    }
    if (ids.length > 1) {
      const newId = await insertLeadAryeoCustomer(client, row);
      for (const other of ids) {
        await insertDedupCandidate(client, newId, other, "name_company", "low");
      }
      return { leadId: newId, created: true };
    }
  }

  const newId = await insertLeadAryeoCustomer(client, row);
  return { leadId: newId, created: true };
}

export async function ingestAryeoActivity(
  client: PoolClient,
  raw: unknown,
): Promise<AryeoIngestOutcome> {
  if (!isRecord(raw)) {
    await insertSyncEvent(client, {
      system: SYSTEM,
      eventType: "unknown",
      externalId: null,
      leadId: null,
      action: "skipped",
      details: { reason: "payload_not_object" },
    });
    return { handled: false };
  }

  const name = str(raw.name);
  if (!name || !ORDER_NAMES.has(name)) {
    await insertSyncEvent(client, {
      system: SYSTEM,
      eventType: name ?? "unknown",
      externalId: str(raw.id),
      leadId: null,
      action: "skipped",
      details: { reason: "order_event_only_stub" },
    });
    return { handled: false };
  }

  const resource = raw.resource;
  if (!isRecord(resource) || str(resource.object) !== "ORDER") {
    await insertSyncEvent(client, {
      system: SYSTEM,
      eventType: name,
      externalId: str(raw.id),
      leadId: null,
      action: "skipped",
      details: { reason: "missing_order_resource" },
    });
    return { handled: false };
  }

  const orderId = str(resource.id);
  if (!orderId) {
    await insertSyncEvent(client, {
      system: SYSTEM,
      eventType: name,
      externalId: str(raw.id),
      leadId: null,
      action: "skipped",
      details: { reason: "missing_order_id" },
    });
    return { handled: false };
  }

  const customer = isRecord(resource.customer) ? resource.customer : null;
  let leadId: string | null = null;

  if (customer) {
    const customerUuid = str(customer.id);
    const custName = str(customer.name);
    const sp = splitFullName(custName);
    const phoneRaw = str(customer.phone);
    const row = {
      first_name: normalizePersonNamePart(sp.first),
      last_name: normalizePersonNamePart(sp.last),
      email: normalizeEmail(str(customer.email)),
      phone: normalizePhoneE164(phoneRaw),
      phone_raw: phoneRaw,
      company_name: normalizeCompanyName(str(customer.office_name)),
      license_number: normalizePersonNamePart(str(customer.license_number)),
    };

    const { leadId: lid } = await resolveLeadForAryeoCustomer(
      client,
      customerUuid,
      row,
    );
    leadId = lid;
    if (customerUuid) {
      const conflict = await upsertLeadExternalId(
        client,
        lid,
        ARYEO_CUSTOMER,
        customerUuid,
        null,
      );
      if (conflict) {
        await insertSyncEvent(client, {
          system: SYSTEM,
          eventType: name,
          externalId: orderId,
          leadId: lid,
          action: "error",
          details: {
            reason: "aryeo_customer_external_id_conflict",
            existingLeadId: conflict.existingLeadId,
          },
        });
        throw new Error(`aryeo customer ${customerUuid} maps to another lead`);
      }
    }
  }

  const addr = isRecord(resource.address) ? resource.address : null;
  const propertyAddress = addr ? { ...addr } : null;

  const orderUuid = await upsertAryeoOrder(client, {
    aryeoOrderId: orderId,
    leadId,
    aryeoIdentifier: str(resource.identifier),
    title: str(resource.title),
    orderStatus: str(resource.order_status),
    fulfillmentStatus: str(resource.fulfillment_status),
    paymentStatus: str(resource.payment_status),
    totalAmount: typeof resource.total_amount === "number" ? resource.total_amount : null,
    balanceAmount:
      typeof resource.balance_amount === "number" ? resource.balance_amount : null,
    totalTaxAmount:
      typeof resource.total_tax_amount === "number" ? resource.total_tax_amount : null,
    totalDiscountAmount:
      typeof resource.total_discount_amount === "number"
        ? resource.total_discount_amount
        : null,
    currency: str(resource.currency) ?? "USD",
    propertyAddress,
    internalNotes: str(resource.internal_notes),
    tags: strArr(resource.tags),
    fulfilledAt: parseTimestamptz(str(resource.fulfilled_at)),
    createdAt: parseTimestamptz(str(resource.created_at)),
    updatedAt: parseTimestamptz(str(resource.updated_at)),
    rawPayload: resource,
  });

  const itemsRaw = resource.items;
  const items: Array<{
    aryeoItemId: string;
    title: string | null;
    purchasableType: string | null;
    unitPriceAmount: number | null;
    quantity: number | null;
    grossTotalAmount: number | null;
    isCanceled: boolean;
    isServiceable: boolean | null;
  }> = [];

  if (Array.isArray(itemsRaw)) {
    for (const it of itemsRaw) {
      if (!isRecord(it)) continue;
      const iid = str(it.id);
      if (!iid) continue;
      items.push({
        aryeoItemId: iid,
        title: str(it.title),
        purchasableType: str(it.purchasable_type),
        unitPriceAmount:
          typeof it.unit_price_amount === "number" ? it.unit_price_amount : null,
        quantity: typeof it.quantity === "number" ? it.quantity : null,
        grossTotalAmount:
          typeof it.gross_total_amount === "number" ? it.gross_total_amount : null,
        isCanceled: Boolean(it.is_canceled),
        isServiceable:
          typeof it.is_serviceable === "boolean" ? it.is_serviceable : null,
      });
    }
  }

  await replaceOrderItems(client, orderUuid, items);

  await insertSyncEvent(client, {
    system: SYSTEM,
    eventType: name,
    externalId: orderId,
    leadId,
    action: "updated",
    details: {
      activity_id: str(raw.id),
      items: items.length,
    },
  });

  return {
    handled: true,
    activityName: name,
    aryeoOrderId: orderId,
    orderUuid,
    leadId,
  };
}

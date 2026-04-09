import { normalizeEmail } from "../lib/normalize.js";
import { aryeoParseDataArray, listAryeoCustomersPage } from "../integrations/aryeoClient.js";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const ARYEO_CUSTOMER_UUID_RE =
  /(?:app\.)?aryeo\.com\/customers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** Scan string values on a GHL contact for an embedded Aryeo customer UUID (profile link, etc.). */
export function extractAryeoCustomerIdFromGhlContact(contact: Record<string, unknown>): string | null {
  const candidates: string[] = [];

  const push = (v: unknown) => {
    if (typeof v === "string" && v.includes("aryeo")) candidates.push(v);
  };

  push(contact.email);
  push(contact.phone);
  for (const key of ["customFields", "customField"] as const) {
    const cf = contact[key];
    if (Array.isArray(cf)) {
      for (const row of cf) {
        if (!isRecord(row)) continue;
        push(row.value);
        push(row.fieldValue);
      }
    }
  }

  for (const s of candidates) {
    const m = s.match(ARYEO_CUSTOMER_UUID_RE);
    if (m?.[1]) return m[1].toLowerCase();
  }

  return null;
}

function str(x: unknown): string | null {
  return typeof x === "string" ? x : null;
}

/** Walk `/customers` pages until email matches (case-insensitive) or max pages. */
export async function findAryeoCustomerIdByEmail(
  apiKey: string,
  emailRaw: string | null | undefined,
  baseUrl: string | undefined,
  options?: { maxPages?: number },
): Promise<string | null> {
  const email = normalizeEmail(emailRaw);
  if (!email) return null;
  const maxPages = options?.maxPages ?? 40;

  for (let page = 1; page <= maxPages; page++) {
    const r = await listAryeoCustomersPage(apiKey, page, baseUrl, {
      perPage: 100,
    });
    if (!r.ok) return null;
    const rows = aryeoParseDataArray(r.data);
    if (rows.length === 0) return null;

    for (const row of rows) {
      if (!isRecord(row)) continue;
      const em = normalizeEmail(str(row.email));
      if (em && em === email) {
        const id = str(row.id);
        if (id?.trim()) return id.trim();
      }
    }

    if (rows.length < 100) return null;
  }
  return null;
}

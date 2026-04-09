const GHL_API_BASE = "https://services.leadconnectorhq.com";

const GHL_HEADERS = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  Version: "2021-07-28",
  Accept: "application/json",
});

export type GhlUpdateContactResult =
  | { ok: true; status: number }
  | { ok: false; status: number; body: string };

async function ghlSearchDuplicateContactOnce(
  accessToken: string,
  locationId: string,
  email: string | null,
  phone: string | null,
): Promise<{ ok: true; contactId: string | null } | { ok: false; status: number; body: string }> {
  const url = new URL(`${GHL_API_BASE}/contacts/search/duplicate`);
  url.searchParams.set("locationId", locationId.trim());
  if (email) {
    url.searchParams.set("email", email);
  }
  if (phone) {
    url.searchParams.set("phone", phone);
  }
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: GHL_HEADERS(accessToken),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: text };
  }
  let j: unknown;
  try {
    j = JSON.parse(text) as unknown;
  } catch {
    return { ok: true, contactId: null };
  }
  const id = extractGhlContactIdFromDuplicateResponse(j);
  return { ok: true, contactId: id };
}

/**
 * Look up existing contact by email/phone within a location (duplicate rules apply).
 * With no email and no phone, returns "no duplicate" without calling the API (GHL returns 422 for location-only).
 * If both are set and GHL returns 422 (e.g. invalid phone format), retries email-only then phone-only.
 */
export async function ghlSearchDuplicateContact(
  accessToken: string,
  params: { locationId: string; email?: string | null; phone?: string | null },
): Promise<{ ok: true; contactId: string | null } | { ok: false; status: number; body: string }> {
  const email = params.email?.trim() || null;
  const phone = params.phone?.trim() || null;
  if (!email && !phone) {
    return { ok: true, contactId: null };
  }

  const loc = params.locationId.trim();
  let r = await ghlSearchDuplicateContactOnce(accessToken, loc, email, phone);
  if (r.ok || r.status !== 422) {
    return r;
  }
  if (email && phone) {
    r = await ghlSearchDuplicateContactOnce(accessToken, loc, email, null);
    if (r.ok || r.status !== 422) {
      return r;
    }
    r = await ghlSearchDuplicateContactOnce(accessToken, loc, null, phone);
  }
  return r;
}

function extractGhlContactIdFromDuplicateResponse(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const direct = p.id ?? p.contactId;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const c = p.contact ?? p.duplicate;
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const id = (c as { id?: string }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  const arr = p.contacts;
  if (Array.isArray(arr) && arr[0] && typeof arr[0] === "object") {
    const id = (arr[0] as { id?: string }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

export type GhlCreateContactResult =
  | { ok: true; status: number; contactId: string }
  | { ok: false; status: number; body: string };

export type GhlGetContactResult =
  | { ok: true; contact: Record<string, unknown> }
  | { ok: false; status: number; body: string };

export async function ghlGetContact(
  accessToken: string,
  contactId: string,
): Promise<GhlGetContactResult> {
  const res = await fetch(`${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}`, {
    method: "GET",
    headers: GHL_HEADERS(accessToken),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: text };
  }
  try {
    const j = JSON.parse(text) as unknown;
    const contact =
      j && typeof j === "object" && !Array.isArray(j) && "contact" in (j as object)
        ? (j as { contact: Record<string, unknown> }).contact
        : (j as Record<string, unknown>);
    if (!contact || typeof contact !== "object") {
      return { ok: false, status: res.status, body: "invalid contact response" };
    }
    return { ok: true, contact };
  } catch {
    return { ok: false, status: res.status, body: text.slice(0, 500) };
  }
}

export function ghlExtractTags(contact: Record<string, unknown>): string[] {
  const t = contact.tags;
  if (!Array.isArray(t)) return [];
  return t.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

export function mergeTagList(existing: string[], add: string[]): string[] {
  const s = new Set<string>();
  for (const x of [...existing, ...add]) {
    const v = x.trim();
    if (v) s.add(v);
  }
  return [...s];
}

export type GhlCustomFieldRow = { id: string; value: unknown };

function coerceGhlCustomFieldValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Normalized `{ id, value }` rows from a GET `/contacts/{id}` payload. */
export function ghlExtractCustomFields(contact: Record<string, unknown>): GhlCustomFieldRow[] {
  const cf = contact.customFields;
  if (!Array.isArray(cf)) return [];
  const out: GhlCustomFieldRow[] = [];
  for (const row of cf) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!id) continue;
    const value = "value" in o ? o.value : o.fieldValue;
    out.push({ id, value });
  }
  return out;
}

/**
 * Full customFields array for PUT: keeps existing GHL values and overlays outbound updates by field id.
 * Avoids sending a partial `customFields` array that would clear fields not included in the request.
 */
export function mergeGhlCustomFieldsForUpdate(
  existing: GhlCustomFieldRow[],
  updates: Array<{ id: string; value: string }>,
): Array<{ id: string; value: string }> {
  const byId = new Map<string, string>();
  for (const row of existing) {
    byId.set(row.id, coerceGhlCustomFieldValue(row.value));
  }
  for (const u of updates) {
    byId.set(u.id, u.value);
  }
  return [...byId.entries()].map(([id, value]) => ({ id, value }));
}

export async function ghlCreateContact(
  accessToken: string,
  body: Record<string, unknown>,
): Promise<GhlCreateContactResult> {
  const res = await fetch(`${GHL_API_BASE}/contacts/`, {
    method: "POST",
    headers: {
      ...GHL_HEADERS(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: text };
  }
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const id =
      (typeof j.contact === "object" &&
        j.contact &&
        typeof (j.contact as { id?: string }).id === "string" &&
        (j.contact as { id: string }).id) ||
      (typeof j.id === "string" ? j.id : null);
    if (!id) {
      return { ok: false, status: res.status, body: `no contact id in response: ${text.slice(0, 500)}` };
    }
    return { ok: true, status: res.status, contactId: id };
  } catch {
    return { ok: false, status: res.status, body: text.slice(0, 500) };
  }
}

export async function ghlUpdateContact(
  accessToken: string,
  contactId: string,
  body: Record<string, unknown>,
): Promise<GhlUpdateContactResult> {
  const res = await fetch(`${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}`, {
    method: "PUT",
    headers: {
      ...GHL_HEADERS(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: text };
  }
  if (text.trim()) {
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      if (typeof j.succeded === "boolean" && j.succeded === false) {
        return { ok: false, status: res.status, body: text.slice(0, 2000) };
      }
      if (typeof j.succeeded === "boolean" && j.succeeded === false) {
        return { ok: false, status: res.status, body: text.slice(0, 2000) };
      }
    } catch {
      /* empty or non-JSON body is OK */
    }
  }
  return { ok: true, status: res.status };
}

export type GhlSearchContactsPageResult =
  | {
      ok: true;
      contactIds: string[];
      /** Prefer stopping when `false`; if unknown, caller may stop when fewer than `pageLimit` ids are returned. */
      hasMore: boolean;
    }
  | { ok: false; status: number; body: string };

function extractGhlSearchContactsList(j: unknown): Array<Record<string, unknown>> {
  if (!j || typeof j !== "object" || Array.isArray(j)) return [];
  const o = j as Record<string, unknown>;
  const a = o.contacts;
  if (Array.isArray(a)) {
    return a.filter(
      (x): x is Record<string, unknown> =>
        x != null && typeof x === "object" && !Array.isArray(x),
    );
  }
  const d = o.data;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    const inner = (d as Record<string, unknown>).contacts;
    if (Array.isArray(inner)) {
      return inner.filter(
        (x): x is Record<string, unknown> =>
          x != null && typeof x === "object" && !Array.isArray(x),
      );
    }
  }
  return [];
}

function inferGhlSearchHasMore(
  j: unknown,
  got: number,
  pageLimit: number,
): boolean {
  if (got === 0) return false;
  if (got < pageLimit) return false;
  if (!j || typeof j !== "object" || Array.isArray(j)) return got >= pageLimit;
  const o = j as Record<string, unknown>;
  const meta = o.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const m = meta as Record<string, unknown>;
    if (typeof m.nextPage === "boolean") return m.nextPage;
    if (typeof m.hasNextPage === "boolean") return m.hasNextPage;
  }
  return got >= pageLimit;
}

/**
 * Paginated contact search within a location (POST `/contacts/search`).
 * Uses `page` + `pageLimit`; stop when a page returns fewer than `pageLimit` contacts or `hasMore` is false.
 */
export async function ghlSearchContactsPage(
  accessToken: string,
  params: {
    locationId: string;
    page: number;
    pageLimit: number;
  },
): Promise<GhlSearchContactsPageResult> {
  const loc = params.locationId.trim();
  const tryBodies: Record<string, unknown>[] = [
    { locationId: loc, page: params.page, pageLimit: params.pageLimit },
    { locationId: loc, page: params.page, limit: params.pageLimit },
  ];

  let res = await fetch(`${GHL_API_BASE}/contacts/search`, {
    method: "POST",
    headers: {
      ...GHL_HEADERS(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(tryBodies[0]),
  });
  let text = await res.text();
  if (!res.ok && res.status === 422) {
    res = await fetch(`${GHL_API_BASE}/contacts/search`, {
      method: "POST",
      headers: {
        ...GHL_HEADERS(accessToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(tryBodies[1]),
    });
    text = await res.text();
  }
  if (!res.ok) {
    return { ok: false, status: res.status, body: text };
  }
  let j: unknown;
  try {
    j = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, status: res.status, body: text };
  }
  const list = extractGhlSearchContactsList(j);
  const contactIds = list
    .map((c) => (typeof c.id === "string" ? c.id.trim() : null))
    .filter((x): x is string => Boolean(x));
  const hasMore = inferGhlSearchHasMore(j, contactIds.length, params.pageLimit);
  return { ok: true, contactIds, hasMore };
}

/** Read-only Aryeo REST client (Bearer). */

const DEFAULT_BASE = "https://api.aryeo.com/v1";

export type AryeoApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; body: string };

function joinBase(base: string, path: string): string {
  const b = base.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

const DEFAULT_FETCH_TIMEOUT_MS = 120_000;

export async function aryeoGetJson(
  apiKey: string,
  path: string,
  options?: { baseUrl?: string; signal?: AbortSignal },
): Promise<AryeoApiResult<unknown>> {
  const baseUrl = options?.baseUrl?.trim() || DEFAULT_BASE;
  const signal =
    options?.signal ??
    (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS)
      : undefined);
  const res = await fetch(joinBase(baseUrl, path), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: text };
  }
  try {
    return { ok: true, status: res.status, data: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: res.status, body: text.slice(0, 500) };
  }
}

/** Full customer / group record: `GET /v1/customers/{uuid}` */
export async function fetchAryeoCustomer(
  apiKey: string,
  customerId: string,
  baseUrl?: string,
): Promise<AryeoApiResult<unknown>> {
  const trimmed = customerId.trim();
  if (!trimmed) {
    return { ok: false, status: 400, body: "empty customer id" };
  }
  return aryeoGetJson(apiKey, `/customers/${encodeURIComponent(trimmed)}`, { baseUrl });
}

/** Paginated customer list: `GET /v1/customers?page=&per_page=` */
export async function listAryeoCustomersPage(
  apiKey: string,
  page: number,
  baseUrl?: string,
  options?: { perPage?: number },
): Promise<AryeoApiResult<unknown>> {
  const p = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const perPage = options?.perPage ?? 100;
  return aryeoGetJson(apiKey, `/customers?page=${p}&per_page=${perPage}`, { baseUrl });
}

/** All orders (paginated): `GET /v1/orders?page=` — group-wide list; bucket rows by `order.customer.id`. */
export async function listAryeoOrdersPage(
  apiKey: string,
  page: number,
  baseUrl?: string,
  options?: { perPage?: number; include?: string },
): Promise<AryeoApiResult<unknown>> {
  const p = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const perPage = options?.perPage ?? 250;
  const include = options?.include ?? "customer";
  const inc = encodeURIComponent(include);
  return aryeoGetJson(apiKey, `/orders?page=${p}&per_page=${perPage}&include=${inc}`, { baseUrl });
}

/**
 * @deprecated Public `GET /orders` does not document `customer_id`; responses match the group-wide list.
 * Use {@link listAryeoOrdersPage} once and filter by `order.customer.id`.
 */
export async function listAryeoOrdersForCustomerPage(
  apiKey: string,
  customerId: string,
  page: number,
  baseUrl?: string,
): Promise<AryeoApiResult<unknown>> {
  const p = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const id = customerId.trim();
  return aryeoGetJson(
    apiKey,
    `/orders?page=${p}&customer_id=${encodeURIComponent(id)}`,
    { baseUrl },
  );
}

export function aryeoParseDataArray(envelope: unknown): unknown[] {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return [];
  const d = (envelope as Record<string, unknown>).data;
  return Array.isArray(d) ? d : [];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * All ORDER rows for a customer: scans group-wide `/orders?include=customer` pages and
 * filters client-side by `order.customer.id`. The `customer_id` query param is not honoured
 * by the Aryeo API and is intentionally not used here.
 *
 * Aryeo caps per_page at 100 regardless of what is requested; pagination is driven by
 * `meta.last_page` in the envelope.
 */
export async function fetchOrderObjectsForAryeoCustomer(
  apiKey: string,
  customerId: string,
  baseUrl?: string,
  options?: { maxPages?: number },
): Promise<unknown[]> {
  const maxPages = options?.maxPages ?? 500;
  const cid = customerId.trim().toLowerCase();
  const out: unknown[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const r = await listAryeoOrdersPage(apiKey, page, baseUrl, { perPage: 100 });
    if (!r.ok) break;
    const rows = aryeoParseDataArray(r.data);
    if (rows.length === 0) break;
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const c = row.customer;
      if (isRecord(c) && typeof c.id === "string" && c.id.trim().toLowerCase() === cid) {
        out.push(row);
      }
    }
    // Use meta.last_page when available; fall back to checking if this was a short page
    const meta = isRecord(r.data) ? r.data.meta : null;
    const lastPage = isRecord(meta) && typeof meta.last_page === "number" ? meta.last_page : null;
    if (lastPage !== null ? page >= lastPage : rows.length < 100) break;
  }
  return out;
}

import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";

export function normalizeEmail(raw: string | null | undefined): string | null {
  const t = raw?.trim().toLowerCase();
  return t || null;
}

export function normalizeCompanyName(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  return t || null;
}

export function normalizePersonNamePart(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  return t || null;
}

/** Split Zendesk-style full name on first space; remainder is last name (may be empty). */
export function splitFullName(full: string | null | undefined): {
  first: string | null;
  last: string | null;
} {
  const t = full?.trim();
  if (!t) return { first: null, last: null };
  const i = t.indexOf(" ");
  if (i === -1) return { first: t, last: null };
  return {
    first: t.slice(0, i).trim() || null,
    last: t.slice(i + 1).trim() || null,
  };
}

export function normalizePhoneE164(
  raw: string | null | undefined,
  defaultCountry: CountryCode = "US",
): string | null {
  if (raw == null || !String(raw).trim()) return null;
  const parsed = parsePhoneNumberFromString(String(raw).trim(), defaultCountry);
  return parsed?.format("E.164") ?? null;
}

export function parseIsoDateOnly(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function parseTimestamptz(raw: string | null | undefined): Date | null {
  if (raw == null || typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function mergeDistinctTags(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].sort((x, y) => x.localeCompare(y));
}

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

/** Extension / second-number suffix (take first segment before this). */
const PHONE_EXT_SUFFIX = /\s*(?:ext\.?|extension|x)\s*[\d.]+\s*$/i;

function takeFirstPhoneCandidate(raw: string): string {
  const first = raw.split(/[;|/]/u)[0]?.trim() ?? "";
  return first.replace(PHONE_EXT_SUFFIX, "").trim();
}

const DIGITS_ONLY = /\D/g;

/**
 * Best-effort E.164 for GHL APIs (duplicate search, contact create). Handles messy CRM strings:
 * extensions, multiple numbers, punctuation, US 10-digit without country code.
 */
export function normalizePhoneForGhl(
  raw: string | null | undefined,
  defaultCountry: CountryCode = "US",
): string | null {
  if (raw == null || !String(raw).trim()) return null;
  const candidate = takeFirstPhoneCandidate(String(raw).trim());
  if (!candidate) return null;

  const direct = normalizePhoneE164(candidate, defaultCountry);
  if (direct) return direct;

  const digits = candidate.replace(DIGITS_ONLY, "");
  if (digits.length < 10) return null;

  if (digits.length === 10) {
    const us = normalizePhoneE164(`+1${digits}`, defaultCountry);
    if (us) return us;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    const us = normalizePhoneE164(`+${digits}`, defaultCountry);
    if (us) return us;
  }

  const intl = parsePhoneNumberFromString(`+${digits}`, defaultCountry);
  if (intl?.isValid()) {
    return intl.format("E.164");
  }
  const intlLoose = parsePhoneNumberFromString(`+${digits}`);
  if (intlLoose?.isValid()) {
    return intlLoose.format("E.164");
  }

  return normalizePhoneE164(candidate.replace(/[().\s-]/g, " ").trim(), defaultCountry);
}

/** Prefer canonical `phone` (E.164); else derive from `phone_raw` for GHL + duplicate lookup. */
export function resolvePhoneForGhl(flat: {
  phone?: string | null;
  phone_raw?: string | null;
}): string | null {
  const p = flat.phone?.trim();
  if (p) return p;
  return normalizePhoneForGhl(flat.phone_raw);
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

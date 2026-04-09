import { createHmac, timingSafeEqual } from "node:crypto";

function headerToSingle(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function hexToBuf(hex: string): Buffer | null {
  const h = hex.trim().toLowerCase();
  if (h.length === 0 || h.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/.test(h)) return null;
  return Buffer.from(h, "hex");
}

/**
 * Aryeo: `Signature` header is HMAC-SHA256 of the raw JSON body (UTF-8), hex-encoded
 * (same as PHP `hash_hmac('sha256', $payloadJson, $secret)`).
 */
export function verifyAryeoWebhookSignature(
  rawBodyUtf8: string,
  signatureHeader: string | string[] | undefined,
  secret: string,
): boolean {
  const secretTrim = secret.trim();
  if (!secretTrim) return false;
  const sigRaw = headerToSingle(signatureHeader)?.trim();
  if (!sigRaw) return false;

  const expectedHex = createHmac("sha256", secretTrim)
    .update(rawBodyUtf8, "utf8")
    .digest("hex");
  const a = hexToBuf(sigRaw);
  const b = hexToBuf(expectedHex);
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

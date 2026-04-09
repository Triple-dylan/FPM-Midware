import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyAryeoWebhookSignature } from "./aryeoWebhookSignature.js";

describe("verifyAryeoWebhookSignature", () => {
  it("accepts hex HMAC-SHA256 of raw UTF-8 body (PHP hash_hmac compatible)", () => {
    const secret = "aryeo-test-secret";
    const body = '{"object":"ACTIVITY","id":"019a"}';
    const sig = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(verifyAryeoWebhookSignature(body, sig, secret)).toBe(true);
  });

  it("rejects tampered body", () => {
    const secret = "s";
    const body = '{"a":1}';
    const sig = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(verifyAryeoWebhookSignature('{"a":2}', sig, secret)).toBe(false);
  });

  it("rejects missing or wrong secret / header", () => {
    const body = "{}";
    const sig = createHmac("sha256", "a").update(body, "utf8").digest("hex");
    expect(verifyAryeoWebhookSignature(body, sig, "")).toBe(false);
    expect(verifyAryeoWebhookSignature(body, undefined, "a")).toBe(false);
    expect(verifyAryeoWebhookSignature(body, "not-hex", "a")).toBe(false);
  });
});

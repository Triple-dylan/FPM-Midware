import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("parses PORT and optional DATABASE_URL", () => {
    const c = loadConfig({
      PORT: "4000",
      DATABASE_URL: " postgres://x ",
      WEBHOOK_MAX_BODY_BYTES: "65536",
    });
    expect(c.port).toBe(4000);
    expect(c.databaseUrl).toBe("postgres://x");
    expect(c.webhookMaxBodyBytes).toBe(65536);
  });

  it("defaults PORT to 3000 when unset", () => {
    const c = loadConfig({});
    expect(c.port).toBe(3000);
    expect(c.databaseUrl).toBeUndefined();
    expect(c.webhookMaxBodyBytes).toBe(512 * 1024);
    expect(c.syncAdminToken).toBeUndefined();
    expect(c.ghlAccessToken).toBeUndefined();
    expect(c.aryeoApiKey).toBeUndefined();
    expect(c.aryeoWebhookSecret).toBeUndefined();
  });

  it("reads ARYEO_WEBHOOK_SECRET", () => {
    const c = loadConfig({ ARYEO_WEBHOOK_SECRET: " wh " });
    expect(c.aryeoWebhookSecret).toBe("wh");
  });

  it("rejects invalid PORT", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/Invalid PORT/);
  });
});

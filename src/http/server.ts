import http from "node:http";
import type pg from "pg";
import {
  isAutomationEnabled,
  listAutomationToggles,
  setAutomationEnabled,
} from "../db/repos/automationRepo.js";
import { checkDb } from "../db/pool.js";
import { withTransaction } from "../db/transaction.js";
import { ingestAryeoActivity } from "../services/aryeoIngest.js";
import {
  runAryeoOrderOutboundToGhl,
  type AryeoToGhlOutboundOptions,
} from "../services/aryeoToGhlOutbound.js";
import { ingestGhlContactPayload } from "../services/ghlIngest.js";
import { ingestZendeskWebhook } from "../services/zendeskIngest.js";
import { automationAdminHtml } from "./adminHtml.js";
import { BodyTooLargeError, readJsonBody } from "./readBody.js";

export type HealthStatus = {
  ok: true;
  db: "ok" | "skipped" | "unreachable";
};

function pathOnly(url: string | undefined): string {
  if (!url) return "";
  return url.split("?")[0] ?? url;
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function adminAuthorized(
  req: http.IncomingMessage,
  syncAdminToken: string | undefined,
): boolean {
  const t = syncAdminToken?.trim();
  if (!t) return true;
  const auth = req.headers.authorization;
  return auth === `Bearer ${t}`;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export function createServer(options: {
  pool: pg.Pool | null;
  webhookMaxBodyBytes: number;
  syncAdminToken?: string | undefined;
  ghlAccessToken?: string | undefined;
  ghlLocationId?: string | undefined;
  aryeoCustomerProfileUrlTemplate?: string | undefined;
}): http.Server {
  const server = http.createServer(async (req, res) => {
    const p = pathOnly(req.url ?? "");

    if (req.method === "GET" && p === "/health") {
      const body: HealthStatus = { ok: true, db: "skipped" };
      if (options.pool) {
        try {
          await checkDb(options.pool);
          body.db = "ok";
        } catch {
          body.db = "unreachable";
        }
      }
      res.writeHead(body.db === "unreachable" ? 503 : 200, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify(body));
      return;
    }

    if (!options.pool) {
      json(res, 503, { error: "database_unconfigured" });
      return;
    }

    const pool = options.pool;

    if (req.method === "GET" && p === "/admin") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(automationAdminHtml());
      return;
    }

    if (p === "/api/automations") {
      if (!adminAuthorized(req, options.syncAdminToken)) {
        json(res, 401, { error: "unauthorized" });
        return;
      }
      try {
        if (req.method === "GET") {
          const toggles = await listAutomationToggles(pool);
          json(res, 200, { toggles });
          return;
        }
        if (req.method === "PUT") {
          const raw = await readJsonBody(req, options.webhookMaxBodyBytes);
          if (!isRecord(raw) || !isRecord(raw.toggles)) {
            json(res, 400, { error: "expected { toggles: { [id]: boolean } }" });
            return;
          }
          const allowed = new Set(
            (await listAutomationToggles(pool)).map((r) => r.id),
          );
          for (const [id, v] of Object.entries(raw.toggles)) {
            if (!allowed.has(id) || typeof v !== "boolean") continue;
            await setAutomationEnabled(pool, id, v);
          }
          json(res, 200, { ok: true });
          return;
        }
      } catch (err) {
        if (err instanceof SyntaxError) {
          json(res, 400, { error: "invalid_json" });
          return;
        }
        if (err instanceof BodyTooLargeError) {
          json(res, 413, { error: "payload_too_large" });
          return;
        }
        console.error(err);
        json(res, 500, { error: "internal_error" });
        return;
      }
    }

    try {
      if (req.method === "POST" && p === "/webhooks/ghl/contacts") {
        if (!(await isAutomationEnabled(pool, "inbound_ghl_webhooks"))) {
          json(res, 200, { ok: true, skipped: "toggle_disabled" });
          return;
        }
        const raw = await readJsonBody(req, options.webhookMaxBodyBytes);
        await withTransaction(pool, (c) => ingestGhlContactPayload(c, raw));
        json(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && p === "/webhooks/zendesk") {
        if (!(await isAutomationEnabled(pool, "inbound_zendesk_support_webhooks"))) {
          json(res, 200, { ok: true, skipped: "toggle_disabled" });
          return;
        }
        const raw = await readJsonBody(req, options.webhookMaxBodyBytes);
        await withTransaction(pool, (c) => ingestZendeskWebhook(c, raw));
        json(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && p === "/webhooks/aryeo") {
        if (!(await isAutomationEnabled(pool, "aryeo_webhook_ingest_postgres"))) {
          json(res, 200, { ok: true, skipped: "toggle_disabled" });
          return;
        }
        const raw = await readJsonBody(req, options.webhookMaxBodyBytes);
        const outcome = await withTransaction(pool, (c) => ingestAryeoActivity(c, raw));
        if (outcome.handled) {
          const outbound: AryeoToGhlOutboundOptions = {
            ghlAccessToken: options.ghlAccessToken,
            ghlLocationId: options.ghlLocationId,
            aryeoCustomerProfileUrlTemplate:
              options.aryeoCustomerProfileUrlTemplate ??
              "https://app.aryeo.com/customers/{{id}}",
          };
          void runAryeoOrderOutboundToGhl(pool, outbound, outcome).catch((e) =>
            console.error("aryeo→ghl outbound", e),
          );
        }
        json(res, 200, { ok: true });
        return;
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        json(res, 400, { error: "invalid_json" });
        return;
      }
      if (err instanceof BodyTooLargeError) {
        json(res, 413, { error: "payload_too_large" });
        return;
      }
      console.error(err);
      json(res, 500, { error: "internal_error" });
      return;
    }

    json(res, 404, { error: "not_found" });
  });

  return server;
}

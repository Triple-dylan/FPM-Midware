import { randomUUID } from "node:crypto";
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
import { findOrCreateGhlContactForLead } from "../services/ghlContactCreate.js";
import {
  runAryeoOrderOutboundToGhl,
  type AryeoToGhlOutboundOptions,
} from "../services/aryeoToGhlOutbound.js";
import { ingestGhlContactPayload } from "../services/ghlIngest.js";
import { ingestZendeskWebhook } from "../services/zendeskIngest.js";
import { getDashboardSnapshot } from "../db/repos/dashboardRepo.js";
import { listRecentMonitorOrders, listRecentMonitorSyncEvents } from "../db/repos/monitorRepo.js";
import { verifyAryeoWebhookSignature } from "./aryeoWebhookSignature.js";
import { automationAdminHtml } from "./adminHtml.js";
import { DASHBOARD_POLL_MS } from "./dashboardHtml.js";
import { liveMonitorHtml } from "./monitorHtml.js";
import { BodyTooLargeError, parseJsonFromUtf8, readJsonBody, readUtf8Body } from "./readBody.js";

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

function readRequestId(req: http.IncomingMessage): string {
  const h = req.headers["x-request-id"] ?? req.headers["x-correlation-id"];
  const s = Array.isArray(h) ? h[0] : h;
  const t = s?.trim();
  if (t) return t.slice(0, 128);
  return randomUUID();
}

function attachHttpRequestLog(req: http.IncomingMessage, res: http.ServerResponse, requestId: string): void {
  const t0 = Date.now();
  const method = req.method ?? "?";
  const path = pathOnly(req.url ?? "");
  res.setHeader("x-request-id", requestId);
  res.once("finish", () => {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        msg: "http_request",
        request_id: requestId,
        method,
        path,
        status: res.statusCode,
        duration_ms: Date.now() - t0,
      }),
    );
  });
}

export function createServer(options: {
  pool: pg.Pool | null;
  webhookMaxBodyBytes: number;
  syncAdminToken?: string | undefined;
  ghlAccessToken?: string | undefined;
  ghlLocationId?: string | undefined;
  aryeoCustomerProfileUrlTemplate?: string | undefined;
  aryeoWebhookSecret?: string | undefined;
}): http.Server {
  const server = http.createServer(async (req, res) => {
    const requestId = readRequestId(req);
    attachHttpRequestLog(req, res, requestId);
    const p = pathOnly(req.url ?? "");

    if (req.method === "GET" && p === "/health/live") {
      json(res, 200, { ok: true, service: "fpm-datatool" });
      return;
    }

    if (req.method === "GET" && (p === "/health" || p === "/health/ready")) {
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

    if (req.method === "GET" && (p === "/dashboard" || p === "/monitor")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(liveMonitorHtml());
      return;
    }

    if (req.method === "GET" && (p === "/api/dashboard/feed" || p === "/api/monitor/feed")) {
      if (!adminAuthorized(req, options.syncAdminToken)) {
        json(res, 401, { error: "unauthorized" });
        return;
      }
      try {
        const q = new URL(req.url ?? "", "http://localhost").searchParams;
        const limRaw = q.get("limit");
        const limit = limRaw ? Number.parseInt(limRaw, 10) : 80;
        const [snapshot, sync_events, orders] = await Promise.all([
          getDashboardSnapshot(pool),
          listRecentMonitorSyncEvents(pool, limit),
          listRecentMonitorOrders(pool, limit),
        ]);
        json(res, 200, {
          middleware: { db: "ok" as const },
          refresh_interval_ms: DASHBOARD_POLL_MS,
          metrics: snapshot.metrics,
          automations: snapshot.automations,
          monthly_trend: snapshot.monthly_trend,
          top_customers: snapshot.top_customers,
          order_status_counts: snapshot.order_status_counts,
          leads: snapshot.leads,
          sync_events,
          orders,
        });
      } catch (err) {
        console.error(err);
        json(res, 500, { error: "internal_error" });
      }
      return;
    }

    // PUT /api/leads/:id/commission  { commission_tracked: boolean }
    const leadCommMatch = /^\/api\/leads\/([^/]+)\/commission$/.exec(p);
    if (leadCommMatch && req.method === "PUT") {
      if (!adminAuthorized(req, options.syncAdminToken)) {
        json(res, 401, { error: "unauthorized" });
        return;
      }
      try {
        const leadId = leadCommMatch[1];
        const body = await readJsonBody(req, options.webhookMaxBodyBytes);
        if (!isRecord(body) || typeof body.commission_tracked !== "boolean") {
          json(res, 400, { error: "expected { commission_tracked: boolean }" });
          return;
        }
        const r = await pool.query(
          `update leads set commission_tracked = $1 where id = $2::uuid returning id`,
          [body.commission_tracked, leadId],
        );
        if (r.rowCount === 0) {
          json(res, 404, { error: "lead_not_found" });
          return;
        }
        json(res, 200, { ok: true, id: leadId, commission_tracked: body.commission_tracked });
      } catch (err) {
        if (err instanceof SyntaxError) { json(res, 400, { error: "invalid_json" }); return; }
        if (err instanceof BodyTooLargeError) { json(res, 413, { error: "payload_too_large" }); return; }
        console.error(err);
        json(res, 500, { error: "internal_error" });
      }
      return;
    }

    // GET /api/leads/search?q=...&limit=20
    if (req.method === "GET" && p === "/api/leads/search") {
      if (!adminAuthorized(req, options.syncAdminToken)) {
        json(res, 401, { error: "unauthorized" });
        return;
      }
      try {
        const q = new URL(req.url ?? "", "http://localhost").searchParams;
        const search = (q.get("q") ?? "").trim();
        const limit = Math.min(Number.parseInt(q.get("limit") ?? "20", 10) || 20, 50);
        const rows = await pool.query<{
          id: string;
          name: string;
          email: string | null;
          orders: string;
          value_cents: string;
          commission_tracked: boolean;
        }>(
          `select l.id::text,
                  coalesce(nullif(trim(l.first_name || ' ' || l.last_name), ''), l.email, 'Unknown') as name,
                  l.email,
                  l.commission_tracked,
                  count(o.id)::text as orders,
                  coalesce(sum(o.total_amount) filter (where o.order_status != 'CANCELED'), 0)::text as value_cents
           from leads l
           left join orders o on o.lead_id = l.id
           where l.is_deleted = false
             and (
               $1 = '' or
               lower(coalesce(l.first_name,'') || ' ' || coalesce(l.last_name,'')) like '%' || lower($1) || '%' or
               lower(coalesce(l.email,'')) like '%' || lower($1) || '%'
             )
           group by l.id
           order by l.commission_tracked desc, value_cents::numeric desc, name asc
           limit $2`,
          [search, limit],
        );
        json(res, 200, {
          leads: rows.rows.map((r) => ({
            id: r.id,
            name: r.name,
            email: r.email,
            orders: Number(r.orders),
            value_cents: Number(r.value_cents),
            commission_tracked: r.commission_tracked,
          })),
        });
      } catch (err) {
        console.error(err);
        json(res, 500, { error: "internal_error" });
      }
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
        const rawUtf8 = await readUtf8Body(req, options.webhookMaxBodyBytes);
        const whSecret = options.aryeoWebhookSecret?.trim();
        if (whSecret) {
          if (!verifyAryeoWebhookSignature(rawUtf8, req.headers.signature, whSecret)) {
            json(res, 401, { error: "invalid_signature" });
            return;
          }
        }
        let raw: unknown;
        try {
          raw = parseJsonFromUtf8(rawUtf8);
        } catch {
          json(res, 400, { error: "invalid_json" });
          return;
        }
        const outcome = await withTransaction(pool, (c) => ingestAryeoActivity(c, raw));
        if (outcome.handled) {
          const outbound: AryeoToGhlOutboundOptions = {
            ghlAccessToken: options.ghlAccessToken,
            ghlLocationId: options.ghlLocationId,
            aryeoCustomerProfileUrlTemplate:
              options.aryeoCustomerProfileUrlTemplate ??
              "https://app.aryeo.com/customers/{{id}}",
          };
          void (async () => {
            // If this webhook created a brand-new lead, ensure a GHL contact
            // exists before pushing order summary fields.
            if (outcome.leadCreated && outcome.leadId) {
              await findOrCreateGhlContactForLead(pool, outbound, outcome.leadId);
            }
            await runAryeoOrderOutboundToGhl(pool, outbound, outcome);
          })().catch((e) => console.error("aryeo→ghl outbound", e));
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

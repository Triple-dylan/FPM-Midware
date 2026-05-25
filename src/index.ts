import "dotenv/config";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { createServer } from "./http/server.js";
import { runPeriodicAryeoRefresh } from "./services/periodicAryeoRefresh.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = config.databaseUrl ? createPool(config.databaseUrl) : null;
  const server = createServer({
    pool,
    webhookMaxBodyBytes: config.webhookMaxBodyBytes,
    syncAdminToken: config.syncAdminToken,
    ghlAccessToken: config.ghlAccessToken,
    ghlLocationId: config.ghlLocationId,
    aryeoCustomerProfileUrlTemplate: config.aryeoCustomerProfileUrlTemplate,
    aryeoWebhookSecret: config.aryeoWebhookSecret,
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(config.port, () => {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          msg: "listen",
          port: config.port,
          admin: `http://localhost:${config.port}/admin`,
          dashboard: `http://localhost:${config.port}/dashboard`,
          monitor: `http://localhost:${config.port}/monitor`,
          aryeo_webhook_signature: config.aryeoWebhookSecret ? "required" : "optional",
        }),
      );
      resolve();
    });
    server.on("error", reject);
  });

  const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000; // every 4 hours
  if (pool && config.aryeoApiKey) {
    const ghlOpts = {
      ghlAccessToken: config.ghlAccessToken,
      ghlLocationId: config.ghlLocationId,
      aryeoCustomerProfileUrlTemplate: config.aryeoCustomerProfileUrlTemplate,
    };
    const runRefresh = () => {
      runPeriodicAryeoRefresh(pool, config.aryeoApiKey!, ghlOpts, config.aryeoApiBaseUrl).catch(
        (e) => console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "periodic_aryeo_refresh_uncaught", error: String(e) })),
      );
    };
    // Run once immediately on startup so a fresh deploy always syncs latest data,
    // then repeat every 4 hours.
    runRefresh();
    setInterval(runRefresh, REFRESH_INTERVAL_MS);
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "periodic_aryeo_refresh_scheduled", interval_hours: 4 }));
  }

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "shutdown", signal }));
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await pool?.end();
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown(signal).then(
        () => process.exit(0),
        (err) => {
          console.error(err);
          process.exit(1);
        },
      );
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

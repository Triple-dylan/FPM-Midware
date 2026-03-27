import "dotenv/config";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { createServer } from "./http/server.js";

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
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(config.port, () => {
      console.log(`listening on :${config.port}  admin http://localhost:${config.port}/admin`);
      resolve();
    });
    server.on("error", reject);
  });

  const shutdown = async () => {
    server.close();
    await pool?.end();
  };

  process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

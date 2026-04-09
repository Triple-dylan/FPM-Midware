export type AppConfig = {
  port: number;
  databaseUrl: string | undefined;
  webhookMaxBodyBytes: number;
  /** If set, GET/PUT /api/automations requires Authorization: Bearer … */
  syncAdminToken: string | undefined;
  /** GHL Private Integration Token / OAuth access token for outbound contact updates */
  ghlAccessToken: string | undefined;
  /** Location / sub-account id (required for custom-field UUID refresh + outbound custom fields) */
  ghlLocationId: string | undefined;
  /** Aryeo REST base (read-only usage) */
  aryeoApiBaseUrl: string;
  /** Aryeo API token (Bearer); used for REST reads / validation scripts */
  aryeoApiKey: string | undefined;
  /** Placeholder `{{id}}` = Aryeo customer UUID from order payload */
  aryeoCustomerProfileUrlTemplate: string;
  /** When set, `POST /webhooks/aryeo` requires valid `Signature` (HMAC-SHA256 hex of raw body). */
  aryeoWebhookSecret: string | undefined;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const portRaw = env.PORT ?? "3000";
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${portRaw}`);
  }

  const databaseUrl = env.DATABASE_URL?.trim() || undefined;

  const bodyRaw = env.WEBHOOK_MAX_BODY_BYTES ?? String(512 * 1024);
  const webhookMaxBodyBytes = Number.parseInt(bodyRaw, 10);
  if (!Number.isFinite(webhookMaxBodyBytes) || webhookMaxBodyBytes <= 0) {
    throw new Error(`Invalid WEBHOOK_MAX_BODY_BYTES: ${bodyRaw}`);
  }

  const syncAdminToken = env.SYNC_ADMIN_TOKEN?.trim() || undefined;
  const ghlAccessToken = env.GHL_ACCESS_TOKEN?.trim() || undefined;
  const ghlLocationId = env.GHL_LOCATION_ID?.trim() || undefined;
  const aryeoApiBaseUrl =
    env.ARYEO_API_BASE_URL?.trim() || "https://api.aryeo.com/v1";
  const aryeoApiKey = env.ARYEO_API_KEY?.trim() || undefined;
  const aryeoCustomerProfileUrlTemplate =
    env.ARYEO_CUSTOMER_PROFILE_URL?.trim() ||
    "https://app.aryeo.com/customers/{{id}}";
  const aryeoWebhookSecret = env.ARYEO_WEBHOOK_SECRET?.trim() || undefined;

  return {
    port,
    databaseUrl,
    webhookMaxBodyBytes,
    syncAdminToken,
    ghlAccessToken,
    ghlLocationId,
    aryeoApiBaseUrl,
    aryeoApiKey,
    aryeoCustomerProfileUrlTemplate,
    aryeoWebhookSecret,
  };
}

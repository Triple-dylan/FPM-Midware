/**
 * Verify GHL_ACCESS_TOKEN + GHL_LOCATION_ID (LeadConnector read-only GET).
 *   npx tsx scripts/ghl-ping.ts
 */
import "dotenv/config";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const token = process.env.GHL_ACCESS_TOKEN?.trim();
const locationId = process.env.GHL_LOCATION_ID?.trim();

if (!token) {
  console.error("GHL_ACCESS_TOKEN is required");
  process.exit(1);
}
if (!locationId) {
  console.error("GHL_LOCATION_ID is required");
  process.exit(1);
}

const url = `${GHL_API_BASE}/locations/${encodeURIComponent(locationId)}`;
const res = await fetch(url, {
  headers: {
    Authorization: `Bearer ${token}`,
    Version: "2021-07-28",
    Accept: "application/json",
  },
});

const text = await res.text();
console.log(res.status, res.statusText);
console.log(text.slice(0, 2000));

if (!res.ok) process.exit(1);

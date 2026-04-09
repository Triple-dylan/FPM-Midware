/**
 * Verify `ARYEO_API_KEY` from `.env` against the Aryeo REST API (read-only GET).
 *   npx tsx scripts/aryeo-ping.ts
 */
import "dotenv/config";

const base = (process.env.ARYEO_API_BASE_URL?.trim() || "https://api.aryeo.com/v1").replace(
  /\/$/,
  "",
);
const key = process.env.ARYEO_API_KEY?.trim();
if (!key) {
  console.error("Missing ARYEO_API_KEY in `.env` (see `.env.example`).");
  process.exit(1);
}

// Minimal list call (Aryeo expects `page` as an integer, not JSON:API-style page[size]).
const url = `${base}/orders?page=1`;

const res = await fetch(url, {
  headers: {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  },
});

const text = await res.text();
console.log(res.status, res.statusText);
console.log(text.slice(0, 2000));

if (!res.ok) process.exit(1);

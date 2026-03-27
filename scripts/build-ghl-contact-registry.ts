/**
 * Reads workspace CSVs and writes src/config/ghlContactFieldRegistry.generated.json
 * Run: npx tsx scripts/build-ghl-contact-registry.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const allPath = join(root, "GHL Definitions - All GHL custom fields.csv");
const contactPath = join(root, "GHL Definitions - Contact Fields.csv");
const outPath = join(root, "config", "ghlContactFieldRegistry.generated.json");

type RegistryField = {
  mapKey: string;
  label: string;
  folder: string;
  object: string;
  mergeKeyRaw: string;
  definition: string;
  fieldNameInAryeo: string;
  fieldNameInZendesk: string;
  updateFrequency: string;
};

function extractContactMergeKey(uniqueKey: string): string | null {
  const m = uniqueKey.match(/\{\{\s*contact\.([^}\s]+)\s*\}\}/i);
  if (!m) return null;
  return m[1].trim();
}

function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, "").trim();
}

const STANDARD_BODY_MAP: Record<string, string> = {
  first_name: "firstName",
  last_name: "lastName",
  email: "email",
  phone: "phone",
  address1: "address1",
  city: "city",
  state: "state",
  postal_code: "postalCode",
  country: "country",
  website: "website",
  timezone: "timezone",
  date_of_birth: "dateOfBirth",
  source: "source",
  type: "type",
  company_name: "companyName",
  business_name: "companyName",
  notes: "notes",
};

function main(): void {
  const allRaw = readFileSync(allPath, "utf8");
  const allRecords = parse(allRaw, {
    columns: (hdr) => hdr.map((h: string) => normalizeHeader(h)),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];

  const fromDefinitions: RegistryField[] = [];
  for (const row of allRecords) {
    const object = row["Object"]?.trim();
    if (object?.toLowerCase() !== "contact") continue;
    const unique = row["Unique Key"] ?? "";
    const mapKey = extractContactMergeKey(unique);
    if (!mapKey) continue;
    const label = row["Field Name"]?.trim() ?? mapKey;
    const folder = row["Folder"] ?? "";
    fromDefinitions.push({
      mapKey,
      label,
      folder,
      object: "Contact",
      mergeKeyRaw: unique.trim(),
      definition: "",
      fieldNameInAryeo: "",
      fieldNameInZendesk: "",
      updateFrequency: "",
    });
  }

  const contactRaw = readFileSync(contactPath, "utf8");
  const contactRecords = parse(contactRaw, {
    columns: (hdr) => hdr.map((h: string) => normalizeHeader(h)),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Record<string, string>[];

  const byLabel = new Map<string, (typeof contactRecords)[0]>();
  for (const row of contactRecords) {
    const fn = row["Field Name in GHL"]?.replace(/\r?\n/g, " ").trim();
    if (!fn) continue;
    byLabel.set(fn, row);
  }

  const merged = new Map<string, RegistryField>();
  for (const f of fromDefinitions) {
    merged.set(f.mapKey, { ...f });
  }

  for (const row of contactRecords) {
    const apiKey = row["GHL API Key"]?.trim() ?? "";
    const m = apiKey.match(/contact\.([a-zA-Z0-9_]+)/);
    if (!m) continue;
    const mapKey = m[1].trim();
    const label = row["Field Name in GHL"]?.replace(/\r?\n/g, " ").trim() ?? mapKey;
    const existing = merged.get(mapKey);
    const folder = row["Contact: Folder (in GHL)"] ?? existing?.folder ?? "";
    const definition = row["Definition"]?.replace(/\r?\n/g, " ").trim() ?? "";
    const fieldNameInAryeo = row["Field Name in Aryeo"]?.replace(/\r?\n/g, " ").trim() ?? "";
    const fieldNameInZendesk =
      row["Field Name in Zendesk Support"]?.replace(/\r?\n/g, " ").trim() ?? "";
    const updateFrequency =
      row["How often is this field updated? (Ben's team / middleware)"]?.trim() ?? "";

    merged.set(mapKey, {
      mapKey,
      label,
      folder,
      object: "Contact",
      mergeKeyRaw: existing?.mergeKeyRaw ?? `{{ contact.${mapKey} }}`,
      definition: definition || existing?.definition || "",
      fieldNameInAryeo: fieldNameInAryeo || existing?.fieldNameInAryeo || "",
      fieldNameInZendesk: fieldNameInZendesk || existing?.fieldNameInZendesk || "",
      updateFrequency,
    });
  }

  const fields = [...merged.values()].sort((a, b) => a.mapKey.localeCompare(b.mapKey));

  const payload = {
    generatedAt: new Date().toISOString(),
    sources: [
      "GHL Definitions - All GHL custom fields.csv",
      "GHL Definitions - Contact Fields.csv",
    ],
    standardBodyKeys: STANDARD_BODY_MAP,
    fields,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${fields.length} contact fields to ${outPath}`);
}

main();

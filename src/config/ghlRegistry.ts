import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type GhlRegistryField = {
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

export type GhlContactFieldRegistry = {
  generatedAt: string;
  sources: string[];
  standardBodyKeys: Record<string, string>;
  fields: GhlRegistryField[];
};

let cached: GhlContactFieldRegistry | null = null;

export function loadGhlContactFieldRegistry(
  projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", ".."),
): GhlContactFieldRegistry {
  if (cached) return cached;
  const path = join(projectRoot, "config", "ghlContactFieldRegistry.generated.json");
  const raw = readFileSync(path, "utf8");
  cached = JSON.parse(raw) as GhlContactFieldRegistry;
  return cached;
}

/** For tests / rebuild without cache */
export function resetGhlRegistryCache(): void {
  cached = null;
}

export function getStandardGhlBodyKey(mapKey: string): string | null {
  const reg = loadGhlContactFieldRegistry();
  return reg.standardBodyKeys[mapKey] ?? null;
}

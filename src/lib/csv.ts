import { readFileSync, writeFileSync } from "node:fs";

/** Excel and RFC 4180 expect UTF-8 with BOM for “CSV (UTF-8)” on Windows. */
export const CSV_UTF8_BOM = "\uFEFF";

/**
 * RFC 4180: records are separated by CRLF (`\r\n`). Using LF alone breaks some Excel builds
 * and tools that split on `\r\n` only.
 */
export const CSV_RECORD_SEPARATOR = "\r\n";

/**
 * Escape one CSV field per RFC 4180: comma, double-quote, CR, or LF in the value → wrap in quotes
 * and double internal quotes.
 */
export function escapeCsvField(val: string | null | undefined): string {
  const s = val == null ? "" : String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build a full UTF-8 BOM CSV document from **logical lines** (each line is one record:
 * fields already joined with commas and per-field escaping applied).
 * Ends with a final CRLF after the last record.
 */
export function formatCsvDocumentUtf8Bom(logicalLines: string[]): string {
  if (logicalLines.length === 0) {
    return CSV_UTF8_BOM;
  }
  return CSV_UTF8_BOM + logicalLines.join(CSV_RECORD_SEPARATOR) + CSV_RECORD_SEPARATOR;
}

/**
 * Write CSV and **read it back** to guarantee the on-disk file matches what we intended
 * (no truncation, no silent encoding swap).
 */
export function writeCsvUtf8BomFileVerified(path: string, logicalLines: string[]): void {
  const body = formatCsvDocumentUtf8Bom(logicalLines);
  writeFileSync(path, body, "utf8");
  const roundTrip = readFileSync(path, "utf8");
  if (roundTrip !== body) {
    throw new Error(
      `CSV verification failed for ${path}: wrote ${body.length} code units, read ${roundTrip.length}`,
    );
  }
}

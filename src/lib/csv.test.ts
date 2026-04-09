import { describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import {
  CSV_RECORD_SEPARATOR,
  CSV_UTF8_BOM,
  escapeCsvField,
  formatCsvDocumentUtf8Bom,
} from "./csv.js";

describe("csv", () => {
  it("escapeCsvField quotes comma, quote, CR, LF", () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField("a\rb")).toBe('"a\rb"');
    expect(escapeCsvField("plain")).toBe("plain");
  });

  it("formatCsvDocumentUtf8Bom uses CRLF between records and trailing CRLF", () => {
    const doc = formatCsvDocumentUtf8Bom(["a,b", "c,d"]);
    expect(doc.startsWith(CSV_UTF8_BOM)).toBe(true);
    expect(doc).toContain(CSV_RECORD_SEPARATOR);
    expect(doc.endsWith(CSV_RECORD_SEPARATOR)).toBe(true);
    const withoutBom = doc.slice(1);
    const lines = withoutBom.split(CSV_RECORD_SEPARATOR).filter((x) => x.length > 0);
    expect(lines).toEqual(["a,b", "c,d"]);
  });

  it("csv-parse round-trips multiline quoted field", () => {
    const row1 = [escapeCsvField("h1"), escapeCsvField("two\nlines")].join(",");
    const doc = formatCsvDocumentUtf8Bom([row1]);
    const records = parse(doc, { bom: true, relax_column_count: true, skip_empty_lines: true });
    expect(records.length).toBe(1);
    expect(records[0]).toEqual(["h1", "two\nlines"]);
  });
});

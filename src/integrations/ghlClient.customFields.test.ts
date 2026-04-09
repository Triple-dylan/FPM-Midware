import { describe, expect, it } from "vitest";
import {
  ghlExtractCustomFields,
  mergeGhlCustomFieldsForUpdate,
} from "./ghlClient.js";

describe("ghlExtractCustomFields", () => {
  it("reads id and value from contact.customFields", () => {
    const rows = ghlExtractCustomFields({
      customFields: [
        { id: "a", value: "1" },
        { id: "b", fieldValue: "2" },
      ],
    });
    expect(rows).toEqual([
      { id: "a", value: "1" },
      { id: "b", value: "2" },
    ]);
  });
});

describe("mergeGhlCustomFieldsForUpdate", () => {
  it("overlays updates onto existing by id", () => {
    const merged = mergeGhlCustomFieldsForUpdate(
      [
        { id: "a", value: "old" },
        { id: "b", value: "keep" },
      ],
      [{ id: "a", value: "new" }],
    );
    expect(merged).toEqual([
      { id: "a", value: "new" },
      { id: "b", value: "keep" },
    ]);
  });
});

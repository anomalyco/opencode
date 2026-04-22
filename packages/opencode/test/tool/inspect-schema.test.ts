import { describe, expect, test } from "bun:test"
import { InspectParametersSchema } from "../../src/tool/read/inspect"

describe("tool.inspect schema", () => {
  test("accepts file action even when other inspect-action fields are present", () => {
    expect(() =>
      InspectParametersSchema.parse({
        action: "file",
        filePath: "README.md",
        offset: 10,
        limit: 20,
        depth: 3,
        follow: true,
        dirs_only: true,
        counts: true,
        mode: "search",
        match: "regex",
        case_sensitive: true,
        scope: "both",
        occurrence: 2,
        max_level: 3,
      }),
    ).not.toThrow()
  })
})

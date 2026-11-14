import { describe, expect, test } from "bun:test"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { Info } from "@opencode/schema/config"
import { Schema } from "effect"

const malformed = (index: number): ConfigNormalize.Diagnostic => ({
  kind: "invalid",
  path: ["instruction_files", String(index)],
  message: "skipped malformed recognized value",
})

describe("ConfigNormalize instruction_files", () => {
  test.each([
    [
      "keeps plain file names in list order",
      ["CLAUDE.md", "AGENTS.md", ".cursorrules"],
      ["CLAUDE.md", "AGENTS.md", ".cursorrules"],
      [],
    ],
    [
      "drops paths, parent references, globs and unsafe characters with one diagnostic each",
      ["AGENTS.md", "docs/RULES.md", "..", "*.md", "bad\u0000.md", "a|b.md"],
      ["AGENTS.md"],
      [1, 2, 3, 4, 5].map(malformed),
    ],
    [
      "removes duplicates and keeps the first position",
      ["CLAUDE.md", "AGENTS.md", "CLAUDE.md"],
      ["CLAUDE.md", "AGENTS.md"],
      [],
    ],
    ["keeps an empty list, which turns instruction files off", [], [], []],
    [
      "uses the default list when no entry is valid",
      ["docs/RULES.md"],
      ["AGENTS.md"],
      [
        malformed(0),
        { kind: "invalid", path: ["instruction_files"], message: "used the default list because no entry is valid" },
      ],
    ],
  ] satisfies [string, string[], string[], ConfigNormalize.Diagnostic[]][])("%s", (_, input, expected, diagnostics) => {
    const result = ConfigNormalize.normalize({ instruction_files: input })
    if (result.type !== "normalized") throw new Error("expected normalized config")
    expect(Schema.decodeUnknownExit(Info)(result.encoded)._tag).toBe("Success")
    expect(result.encoded.instruction_files).toEqual(expected)
    expect(result.diagnostics).toEqual(diagnostics)
  })
})

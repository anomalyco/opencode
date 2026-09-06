import { describe, expect, test } from "bun:test"
import { Notebook } from "@opencode-ai/core/notebook/notebook"
import { NotebookAttach } from "@opencode-ai/core/notebook/attach"
import type { ToolOutput } from "@opencode-ai/llm"

const {
  emptyNotebook,
  parseNotebook,
  serializeNotebook,
  relationFolder,
  relTo,
  scoreEntry,
  scoreRelation,
  applyOps,
  unifiedDiff,
} = Notebook

describe("Notebook.parse/serialize", () => {
  test("round-trips entries and relations", () => {
    const nb = emptyNotebook("/root/src", "src")
    nb.summary = "The core library."
    nb.based_on = ["src/index.ts@100-123"]
    nb.entries["index.ts"] = {
      name: "index.ts",
      summary: "Entry point wiring.",
      based_on: ["src/index.ts@100-123"],
      confidence: "verified",
    }
    nb.entries["util.ts"] = {
      name: "util.ts",
      summary: "Helpers.",
      based_on: [],
      confidence: "observed",
    }
    nb.relations = [
      { from: "index.ts", to: "util.ts", description: "index uses util", based_on: [], confidence: "observed" },
    ]
    const parsed = parseNotebook(serializeNotebook(nb), "/root/src", "src")
    expect(parsed.summary).toBe("The core library.")
    expect(parsed.based_on).toEqual(["src/index.ts@100-123"])
    expect(parsed.entries["index.ts"]).toMatchObject({ summary: "Entry point wiring.", confidence: "verified" })
    expect(parsed.entries["util.ts"]).toMatchObject({ summary: "Helpers.", confidence: "observed" })
    expect(parsed.relations).toHaveLength(1)
  })

  test("ignores malformed input safely", () => {
    const parsed = parseNotebook("not: [valid: yaml", "/root", "")
    expect(parsed.summary).toBe("")
    expect(Object.keys(parsed.entries)).toHaveLength(0)
  })

  test("does not instantiate JS tags from a hostile notebook (no RCE via !!js/function)", () => {
    const hostile = "summary: !!js/function >\n  function evil(){ return 1; }\nentries: {}\n"
    const parsed = parseNotebook(hostile, "/root", "")
    expect(parsed.summary).toBe("")
    expect(Object.keys(parsed.entries)).toHaveLength(0)
  })
})

describe("Notebook tree placement", () => {
  test("finds the lowest common ancestor folder", () => {
    expect(relationFolder("src/a.ts", "src/b.ts")).toBe("src")
    expect(relationFolder("packages/core/a.ts", "packages/plugin/b.ts")).toBe("packages")
    expect(relationFolder("a.ts", "b.ts")).toBe("")
  })

  test("relTo relativizes to the target folder", () => {
    expect(relTo("src/a.ts", "src")).toBe("a.ts")
    expect(relTo("a.ts", "")).toBe("a.ts")
    expect(relTo("packages/core/a.ts", "packages")).toBe("core/a.ts")
  })
})

describe("Notebook scoring", () => {
  test("scores entries and relations by keyword overlap", () => {
    const entry = { name: "auth.ts", summary: "handles login tokens", based_on: [], confidence: "observed" as const }
    expect(scoreEntry(entry, "login token flow")).toBeGreaterThan(0)
    expect(scoreEntry(entry, "unrelated")).toBe(0)

    const rel = { from: "a.ts", to: "b.ts", description: "wires the database", based_on: [], confidence: "observed" as const }
    expect(scoreRelation(rel, "database wiring")).toBeGreaterThan(0)
    expect(scoreRelation(rel, "zzz")).toBe(0)
  })
})

describe("Notebook ops", () => {
  test("applies folder, entry, and relation ops", () => {
    const base = emptyNotebook("/root", "")
    const result = applyOps(base, [
      { kind: "folder", summary: "Root role.", basedOn: ["pkg.json@1-2"] },
      { kind: "entry", name: "a.ts", summary: "Does a.", basedOn: ["a.ts@1-2"], confidence: "observed" },
      { kind: "relation", from: "a.ts", to: "b.ts", description: "a uses b", basedOn: [], confidence: "inferred" },
    ])
    expect(result.dirty).toBe(true)
    expect(result.nb.summary).toBe("Root role.")
    expect(result.nb.entries["a.ts"]).toMatchObject({ summary: "Does a." })
    expect(result.nb.relations[0]).toMatchObject({ from: "a.ts", to: "b.ts" })

    const updated = applyOps(result.nb, [
      { kind: "entry", name: "a.ts", summary: "Does a better.", basedOn: ["a.ts@3-4"], confidence: "observed" },
      { kind: "removeRelation", from: "a.ts", to: "b.ts" },
    ])
    expect(updated.nb.entries["a.ts"].summary).toBe("Does a better.")
    expect(updated.nb.entries["a.ts"].based_on).toEqual(["a.ts@1-2", "a.ts@3-4"])
    expect(updated.nb.relations).toHaveLength(0)
  })
})

describe("NotebookAttach.prependNote", () => {
  test("merges the note into a single-text output, preserving the text result type", () => {
    const output: ToolOutput = { structured: {}, content: [{ type: "text", text: "file body" }] }
    const decorated = NotebookAttach.prependNote(output, "## Local notebook · a.ts [✓]")
    expect(decorated.content).toEqual([{ type: "text", text: `## Local notebook · a.ts [✓]\n\nfile body` }])
  })

  test("prepends a text part when the output has multiple parts or media", () => {
    const output: ToolOutput = {
      structured: {},
      content: [
        { type: "text", text: "body" },
        { type: "text", text: "stats" },
      ],
    }
    const decorated = NotebookAttach.prependNote(output, "note")
    expect(decorated.content).toHaveLength(3)
    expect(decorated.content[0]).toEqual({ type: "text", text: "note" })
    expect(decorated.content[1]).toEqual({ type: "text", text: "body" })
  })

  test("returns the output unchanged when there is no note", () => {
    const output: ToolOutput = { structured: {}, content: [{ type: "text", text: "file body" }] }
    expect(NotebookAttach.prependNote(output, "")).toBe(output)
  })
})

describe("Notebook unifiedDiff", () => {
  test("emits an empty diff for identical text and non-empty hunk otherwise", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\n", "x")).toBe("")
    const diff = unifiedDiff("a\nb\nc\n", "a\nd\nc\n", "x")
    expect(diff).toContain("--- a/x")
    expect(diff).toContain("+++ b/x")
  })
})

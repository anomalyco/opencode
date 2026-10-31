import { describe, expect, test } from "bun:test"
import {
  canonicalToolName,
  executeCallSummary,
  finiteNumber,
  genericToolSummary,
  primitiveInputSummary,
  toolDisplayMetadata,
  webSearchProviderLabel,
} from "../../src/util/tool-display"
import { stringWidth } from "../../src/util/string-width"

test("normalizes shared tool primitives", () => {
  expect(["bash", "task", "apply_patch", "plugin_tool"].map(canonicalToolName)).toEqual([
    "shell",
    "subagent",
    "patch",
    "plugin_tool",
  ])
  expect([finiteNumber(-1.5), finiteNumber(Number.NaN), finiteNumber("1")]).toEqual([-1.5, undefined, undefined])
  expect(primitiveInputSummary({ command: "pwd", count: 2, nested: {} })).toBe("[command=pwd, count=2]")
  expect(primitiveInputSummary({ path: "src/a.ts", line: 2 }, ["path"])).toBe("[line=2]")
})

describe("tool input summaries", () => {
  test("elides long multi-line values while preserving subsequent short arguments", () => {
    const content = `${"Hallazgos del 2026-09-13:\nLine two details.\n".repeat(120)}DOCUMENT_TAIL_MARKER`
    const summary = genericToolSummary("ingest_document", { content, format: "markdown" })

    expect(summary).not.toContain("\n")
    expect(summary).not.toContain("DOCUMENT_TAIL_MARKER")
    expect(summary).toContain("…")
    expect(summary).toContain("format=markdown]")
    expect(stringWidth(summary)).toBeLessThanOrEqual(120)
  })

  test("bounds total display width across many arguments and wide graphemes", () => {
    const many = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`arg${index}`, `value_${index}_abcdef`]))
    const summary = primitiveInputSummary(many, [], 50)
    expect(summary).toStartWith("[arg0=value_0_abcdef, ")
    expect(summary).toEndWith("…]")
    expect(stringWidth(summary)).toBeLessThanOrEqual(50)

    const cjk = primitiveInputSummary({ text: "天地玄黄宇宙洪荒日月盈昃辰宿列张".repeat(4), to: "en" }, [], 32)
    expect(cjk).not.toContain("\uFFFD")
    expect(stringWidth(cjk)).toBeLessThanOrEqual(32)

    const emoji = executeCallSummary(
      { tool: "chat.post", status: "completed", input: { message: "👨‍👩‍👧‍👦".repeat(30) } },
      36,
    )
    expect(emoji).not.toContain("\uFFFD")
    expect(stringWidth(emoji)).toBeLessThanOrEqual(36)
  })
})

describe("webSearchProviderLabel", () => {
  test("labels known providers", () => {
    expect(webSearchProviderLabel("parallel")).toBe("Web Search via Parallel")
    expect(webSearchProviderLabel("exa")).toBe("Web Search via Exa")
    expect(webSearchProviderLabel("firecrawl")).toBe("Web Search via Firecrawl")
    expect(webSearchProviderLabel("tavily")).toBe("Web Search via Tavily")
    expect(webSearchProviderLabel("opencode")).toBe("Web Search via OpenCode")
  })

  test("labels providers dynamically", () => {
    expect(webSearchProviderLabel("other")).toBe("Web Search via Other")
  })

  for (const [name, provider] of [
    ["undefined", undefined],
    ["null", null],
    ["an object", {}],
    ["an array", []],
    ["a number", 1],
    ["an empty string", ""],
  ] as const) {
    test(`uses the generic label for ${name}`, () => {
      expect(webSearchProviderLabel(provider)).toBe("Web Search")
    })
  }
})

describe("toolDisplayMetadata", () => {
  test("returns tool metadata for non-pending states", () => {
    const metadata = { provider: "parallel", numResults: 3 }

    expect(toolDisplayMetadata({ status: "running", metadata })).toBe(metadata)
    expect(toolDisplayMetadata({ status: "completed", metadata })).toBe(metadata)
    expect(toolDisplayMetadata({ status: "error", metadata })).toBe(metadata)
  })

  test("does not expose pending or malformed metadata", () => {
    expect(toolDisplayMetadata({ status: "streaming", metadata: { provider: "exa" } })).toEqual({})
    expect(toolDisplayMetadata({ status: "completed" })).toEqual({})
    expect(toolDisplayMetadata({ status: "completed", metadata: null })).toEqual({})
    expect(toolDisplayMetadata({ status: "completed", metadata: [] })).toEqual({})
    expect(toolDisplayMetadata(undefined)).toEqual({})
  })
})

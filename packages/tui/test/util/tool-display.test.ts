import { describe, expect, test } from "bun:test"
import {
  canonicalToolName,
  finiteNumber,
  primitiveInputSummary,
  readRangeSuffix,
  toolDisplayMetadata,
  webSearchProviderLabel,
} from "../../src/util/tool-display"

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

describe("readRangeSuffix", () => {
  test.each([
    [{}, ""],
    [{ offset: 120, limit: 40 }, ":120-159"],
    [{ offset: 120 }, ":120-"],
    [{ limit: 40 }, ":1-40"],
    [{ offset: 0, limit: 40 }, ":1-40"],
    [{ offset: 0 }, ":1-"],
    [{ offset: 120, limit: 0 }, ":120-"],
  ] as const)("formats explicitly supplied arguments while running: %j", (input, suffix) => {
    expect(readRangeSuffix({ status: "running", input: { path: "src/agent.ts", ...input }, metadata: {} })).toBe(suffix)
  })

  test.each([
    [{ offset: 120, limit: 40 }, "Read file src/agent.ts, lines 120-159\n120: first\n159: last", ":120-159"],
    [{ offset: 120, limit: 40 }, "Read file src/agent.ts, lines 120-123\n120: first\n123: last", ":120-123"],
    [{ offset: 120 }, "Read file src/agent.ts, lines 120-123\n120: first\n123: last", ":120-123"],
    [{ limit: 40 }, "Read file src/agent.ts, lines 1-3\n1: first\n3: last", ":1-3"],
    [{ offset: 0, limit: 0 }, "Read file src/agent.ts, lines 1-220\n1: first\n220: last", ":1-220"],
    [{ offset: 120, limit: 40 }, "Read file src/agent.ts, 0 lines", ""],
    [{ limit: 40 }, "Image read successfully", ""],
    [{ offset: 2, limit: 40 }, "Read directory src, entries 2-4\na.ts\nb.ts\nc.ts", ":2-4"],
    [{ offset: 2, limit: 40 }, "Read directory src, 0 entries", ""],
    [{}, "Read file src/agent.ts, lines 1-220\n1: first\n220: last", ""],
    [{ limit: 40 }, "Legacy output without a range", ""],
  ] as const)("uses the returned range for completed reads: %j / %s", (input, text, suffix) => {
    expect(
      readRangeSuffix({
        status: "completed",
        input: { path: "src/agent.ts", ...input },
        content: [{ type: "text", text }],
      }),
    ).toBe(suffix)
  })

  test("does not invent a range for streaming or failed reads", () => {
    expect(readRangeSuffix({ status: "streaming", input: '{"offset":120' })).toBe("")
    expect(
      readRangeSuffix({
        status: "error",
        input: { path: "missing.ts", offset: 120, limit: 40 },
        error: { type: "unknown", message: "Missing" },
      }),
    ).toBe("")
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

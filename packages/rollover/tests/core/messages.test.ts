import { describe, expect, test } from "bun:test"
import { showText, statusText } from "../../src/core/messages"

const PREAMBLE =
  "Earlier conversation history was replaced by this record to save context. Treat it as reliable memory of earlier work in this session. Earlier tool outputs and file contents are no longer visible: re-read a file if you need its exact current contents."

const RENDER = [
  "<rollover_context epoch='2'>",
  PREAMBLE,
  "",
  "## Decisions",
  "- [d1] Use cookie sessions (why: user asked)",
  "- [d2] Keep core pure",
  "## Open items",
  "- [i7] flaky integration test",
  "</rollover_context>",
].join("\n")

describe("showText clean view", () => {
  const base = {
    renderText: RENDER,
    renderTokens: 100,
    renderBudgetTokens: 4000,
    epoch: 2,
    counts: { user_correction: 0, decision: 2, open_item: 1 },
    truncated: false,
  }
  test("header, non-zero counts, separator, body", () => {
    const out = showText(base)
    const lines = out.split("\n")
    expect(lines[0]).toBe("Rollover render preview — 100 / 4k tokens (epoch 2)")
    expect(lines[1]).toBe("Decisions: 2 · Open items: 1")
    expect(lines[2]).toBe("─".repeat(46))
    expect(out).toContain("Decisions\n  - [d1] Use cookie sessions (why: user asked)")
    expect(out).toContain("\nOpen items\n  - [i7] flaky integration test")
    expect(out).not.toContain("<rollover_context")
    expect(out).not.toContain("</rollover_context>")
    expect(out).not.toContain("Earlier conversation history")
  })
  test("truncation marker", () => {
    expect(showText({ ...base, truncated: true }).split("\n")[0]).toBe(
      "Rollover render preview — 100 / 4k tokens (epoch 2) · truncated",
    )
  })
  test("multi-line record text stays indented", () => {
    const render = [
      "<rollover_context epoch='1'>",
      PREAMBLE,
      "",
      "## Objectives",
      "- [o1] first line\nsecond line",
      "</rollover_context>",
    ].join("\n")
    const out = showText({
      renderText: render,
      renderTokens: 40,
      renderBudgetTokens: 4000,
      epoch: 1,
      counts: { objective: 1 },
      truncated: false,
    })
    expect(out).toContain("  - [o1] first line\n  second line")
  })
  test("empty ledger", () => {
    const out = showText({
      renderText: ["<rollover_context epoch='0'>", PREAMBLE, "", "</rollover_context>"].join("\n"),
      renderTokens: 50,
      renderBudgetTokens: 4000,
      epoch: 0,
      counts: {},
      truncated: false,
    })
    expect(out).toBe("Rollover render preview — 50 / 4k tokens (epoch 0)\nNo records yet.")
  })
})

describe("showText raw view", () => {
  test("legacy format preserved", () => {
    const out = showText({
      renderText: RENDER,
      renderTokens: 100,
      renderBudgetTokens: 4000,
      epoch: 2,
      counts: { decision: 2, open_item: 1 },
      truncated: true,
      raw: true,
    })
    expect(out).toBe(
      `Render preview (≈ 100 tokens):\n${RENDER}\n\nRecords: objective 0, decision 2, user_correction 0, open_item 1, verification 0`,
    )
  })
})

describe("statusText context source display", () => {
  const base = {
    mode: "auto" as const,
    thresholdValue: 100_000,
    thresholdSource: "computed" as const,
    modelLimit: 200_000,
    contextSource: "usage" as const,
    contextTokens: 50_000,
    tailN: 2,
    summaryModel: null,
    recordCount: 0,
    epoch: 1,
    renderTokens: null,
    renderBudgetTokens: 4000,
    lastRollover: null,
  }
  test("usage source labeled as usage", () => {
    const out = statusText(base)
    expect(out).toContain("Current context: 50k (50% of threshold, usage)")
  })
  test("estimate fallback labeled as estimate", () => {
    const out = statusText({ ...base, contextSource: "estimate" })
    expect(out).toContain("Current context: 50k (50% of threshold, estimate)")
  })
})

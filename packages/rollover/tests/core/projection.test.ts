import { describe, expect, test } from "bun:test"
import { projectRollover, collectTouchedPaths } from "../../src/core/projection"
import type { NMessage, LedgerRecord, RolloverConfig, LedgerLine } from "../../src/core/types"

const cfg: RolloverConfig = {
  mode: "auto",
  thresholdRatio: 0.5,
  thresholdCapTokens: 200_000,
  thresholdMinTokens: 20_000,
  thresholdTokens: null,
  tailN: 2,
  tailMaxN: 20,
  renderBudgetTokens: 4000,
  extractionModel: null,
  extractionDeltaMaxTokens: 12_000,
  extractionTimeoutMs: 180_000,
  consolidateAfterRecords: 40,
  consolidationTimeoutMs: 90_000,
  ledger: true,
  dataDir: ".opencode/rollover",
}

function msg(
  id: string,
  role: "user" | "assistant",
  parts: NMessage["parts"] = [{ type: "text", text: "x" }],
): NMessage {
  return { id, role, parts, createdAt: 0 }
}

function rec(over: Partial<LedgerRecord>): LedgerRecord {
  return {
    kind: "record",
    id: "d1",
    type: "decision",
    text: "Use cookies, not JWT.",
    epoch: 0,
    userMessageId: "u1",
    turnMessageId: "a1",
    createdAt: 0,
    ...over,
  }
}

const linesOf = (records: LedgerRecord[]): LedgerLine[] => records

function project(over: Partial<Parameters<typeof projectRollover>[0]> = {}) {
  const msgs = over.msgs ?? [
    msg("u1", "user", [{ type: "text", text: "add settings endpoint" }]),
    msg("a1", "assistant"),
    msg("u2", "user", [{ type: "text", text: "also fix tests" }]),
  ]
  return projectRollover({
    msgs,
    cutoffId: "u2",
    epoch: 1,
    cfg,
    lines: [],
    touchedFiles: {},
    tailLastReply: null,
    ...over,
  })
}

describe("projectRollover", () => {
  test("deterministic: identical inputs render byte-identically", () => {
    const msgs = [
      msg("u1", "user", [{ type: "text", text: "first prompt" }]),
      msg("a1", "assistant", [{ type: "text", text: "reply line one\nsecond line" }]),
      msg("u2", "user", [{ type: "text", text: "second prompt" }]),
    ]
    const a = projectRollover({ msgs, cutoffId: "u2", epoch: 3, cfg, lines: [], touchedFiles: {}, tailLastReply: null })
    const b = projectRollover({ msgs, cutoffId: "u2", epoch: 3, cfg, lines: [], touchedFiles: {}, tailLastReply: null })
    expect(a.renderText).toBe(b.renderText)
  })

  test("shell with epoch; prompts verbatim under the cap; progress is first lines", () => {
    const r = project({
      msgs: [
        msg("u1", "user", [{ type: "text", text: "add settings endpoint" }]),
        msg("a1", "assistant", [{ type: "text", text: "Done, endpoint added.\nStill missing: validation." }]),
        msg("u2", "user", [{ type: "text", text: "also fix tests" }]),
        msg("a2", "assistant", [{ type: "text", text: "Tests fixed." }]),
      ],
    })
    expect(r.renderText).toContain("<rollover_context epoch='1'>")
    expect(r.renderText).toContain("</rollover_context>")
    expect(r.renderText).toContain("## User prompts")
    expect(r.renderText).toContain("- [u1] add settings endpoint")
    expect(r.renderText).toContain("## Assistant progress")
    expect(r.renderText).toContain("- [a1] Done, endpoint added.")
    expect(r.renderText).not.toContain("- [a1] Still missing")
  })

  test("long user prompts are middle-truncated to the 600-char cap", () => {
    const long = "s".repeat(700) + "MIDDLE" + "e".repeat(700)
    const r = project({
      msgs: [msg("u1", "user", [{ type: "text", text: long }]), msg("u2", "user", [{ type: "text", text: "next" }])],
    })
    const line = r.renderText.split("\n").find((l) => l.startsWith("- [u1]")) ?? ""
    expect(line.length).toBeLessThan(650)
    expect(line).toContain("[...]")
    expect(line).not.toContain("MIDDLE")
  })

  test("assistant progress first lines are capped at 200 chars", () => {
    const r = project({
      msgs: [
        msg("a1", "assistant", [{ type: "text", text: "p".repeat(400) + "\nmore" }]),
        msg("u2", "user", [{ type: "text", text: "next" }]),
        msg("a2", "assistant", [{ type: "text", text: "ok" }]),
      ],
    })
    const line = r.renderText.split("\n").find((l) => l.startsWith("- [a1]")) ?? ""
    expect(line.length).toBeLessThan(210)
  })

  test("no ledger records → no record sections", () => {
    const r = project()
    expect(r.renderText).not.toContain("Standing rules")
    expect(r.renderText).not.toContain("## Decisions")
    expect(r.renderText).not.toContain("Open items")
  })

  test("ledger records before the cutoff render; after the cutoff do not; unknown turn id includes conservatively", () => {
    const records: LedgerRecord[] = [
      rec({ id: "d1", type: "decision", text: "Before cutoff.", turnMessageId: "a1" }),
      rec({ id: "d2", type: "decision", text: "After cutoff.", turnMessageId: "a-later" }),
      rec({ id: "d3", type: "decision", text: "Unknown location.", turnMessageId: "a-unknown" }),
    ]
    const msgs = [
      msg("u1", "user", [{ type: "text", text: "p1" }]),
      msg("a1", "assistant", [{ type: "text", text: "r1" }]),
      msg("u2", "user", [{ type: "text", text: "p2" }]),
      msg("a-later", "assistant", [{ type: "text", text: "r2" }]),
    ]
    const r = projectRollover({
      msgs,
      cutoffId: "u2",
      epoch: 1,
      cfg,
      lines: linesOf(records),
      touchedFiles: {},
      tailLastReply: null,
    })
    expect(r.renderText).toContain("Before cutoff.")
    expect(r.renderText).toContain("Unknown location.")
    expect(r.renderText).not.toContain("After cutoff.")
  })

  test("displaced records render even at a post-swap epoch (enrichment refresh)", () => {
    const records: LedgerRecord[] = [
      rec({ id: "d9", epoch: 2, text: "extracted at the new epoch.", turnMessageId: "a1" }),
    ]
    const msgs = [
      msg("u1", "user", [{ type: "text", text: "p1" }]),
      msg("a1", "assistant", [{ type: "text", text: "r1" }]),
      msg("u2", "user", [{ type: "text", text: "p2" }]),
    ]
    const r = projectRollover({
      msgs,
      cutoffId: "u2",
      epoch: 2,
      cfg,
      lines: linesOf(records),
      touchedFiles: {},
      tailLastReply: null,
    })
    expect(r.renderText).toContain("extracted at the new epoch.")
  })

  test("budget overflow drops the oldest progress lines first", () => {
    const small: RolloverConfig = { ...cfg, renderBudgetTokens: 300, tailN: 0 }
    const msgs: NMessage[] = []
    for (let i = 0; i < 12; i++) {
      msgs.push(msg(`u${i}`, "user", [{ type: "text", text: `prompt number ${i} ` + "w".repeat(150) }]))
      msgs.push(msg(`a${i}`, "assistant", [{ type: "text", text: `reply number ${i} ` + "r".repeat(120) }]))
    }
    const r = projectRollover({
      msgs,
      cutoffId: "u11",
      epoch: 1,
      cfg: small,
      lines: [],
      touchedFiles: {},
      tailLastReply: null,
    })
    expect(r.truncated).toBe(true)
    // the newest pre-cutoff prompt survives; the oldest reply does not
    expect(r.renderText).toContain("prompt number 10")
    expect(r.renderText).not.toContain("- [a0] ")
  })

  test("files touched: from messages plus state, deduped, newest first, max 40", () => {
    const msgs = [
      msg("u1", "user", [{ type: "text", text: "p1" }]),
      msg("a1", "assistant", [
        { type: "tool", tool: "edit", status: "completed", input: { path: "src/one.ts" } },
        { type: "tool", tool: "write", status: "completed", input: { path: "src/two.ts" } },
      ]),
      msg("u2", "user", [{ type: "text", text: "p2" }]),
    ]
    const r = projectRollover({
      msgs,
      cutoffId: "u2",
      epoch: 1,
      cfg,
      lines: [],
      touchedFiles: { "src/three.ts": { epoch: 0, turn: 1 } },
      tailLastReply: null,
    })
    expect(r.renderText).toContain("## Files touched")
    expect(r.renderText).toContain("- src/one.ts")
    expect(r.renderText).toContain("- src/two.ts")
    expect(r.renderText).toContain("- src/three.ts")

    const paths = collectTouchedPaths(msgs, 2)
    expect(Object.keys(paths)).toEqual(["src/one.ts", "src/two.ts"])
  })
})

describe("projection budget honesty (v2)", () => {
  const cfg: RolloverConfig = {
    mode: "auto",
    thresholdRatio: 0.5,
    thresholdCapTokens: 200_000,
    thresholdMinTokens: 20_000,
    thresholdTokens: null,
    tailN: 2,
    tailMaxN: 20,
    renderBudgetTokens: 4000,
    extractionModel: null,
    extractionDeltaMaxTokens: 12_000,
    extractionTimeoutMs: 180_000,
    consolidateAfterRecords: 40,
    consolidationTimeoutMs: 90_000,
    ledger: true,
    dataDir: ".opencode/rollover",
  }

  function msg(
    id: string,
    role: "user" | "assistant",
    parts: { type: string; text?: string; tool?: string; status?: string; input?: unknown; output?: string }[],
  ): NMessage {
    return { id, role, parts: parts as NMessage["parts"], createdAt: 0 }
  }

  test("budget overflow keeps the newest progress prefix (contiguous, never mid-history gaps)", () => {
    const small: RolloverConfig = { ...cfg, renderBudgetTokens: 200 }
    const msgs: NMessage[] = []
    for (let i = 0; i < 8; i++) {
      msgs.push(msg(`u${i}`, "user", [{ type: "text", text: `prompt ${i}` }]))
      msgs.push(msg(`a${i}`, "assistant", [{ type: "text", text: `reply line ${i} ` + "r".repeat(90) }]))
    }
    msgs.push(msg("u8", "user", [{ type: "text", text: "cutoff" }]))
    const r = projectRollover({
      msgs,
      cutoffId: "u8",
      epoch: 1,
      cfg: small,
      lines: [],
      touchedFiles: {},
      tailLastReply: null,
    })
    expect(r.truncated).toBe(true)
    const progressIds = r.renderText
      .split("\n")
      .filter((l) => l.startsWith("- [a"))
      .map((l) => Number(/- \[a(\d+)\]/.exec(l)?.[1]))
    expect(progressIds.length).toBeGreaterThan(0)
    // contiguous newest prefix: no mid-history gaps
    progressIds.forEach((id, i) => expect(id).toBe(progressIds[0] + i))
    expect(progressIds[progressIds.length - 1]).toBe(7)
  })

  test("render stays inside the budget with tool-only turns (truncated stays honest)", () => {
    const small: RolloverConfig = { ...cfg, renderBudgetTokens: 600 }
    const msgs: NMessage[] = []
    for (let i = 0; i < 30; i++) {
      msgs.push(msg(`u${i}`, "user", [{ type: "text", text: `prompt number ${i} ` + "w".repeat(400) }]))
      // assistant turn with ONLY tool parts → no text progress, no reply
      msgs.push(
        msg(`a${i}`, "assistant", [
          { type: "tool", tool: "bash", status: "completed", input: { command: "true" }, output: "ok" },
        ]),
      )
    }
    const r = projectRollover({
      msgs,
      cutoffId: "u29",
      epoch: 1,
      cfg: small,
      lines: [],
      touchedFiles: {},
      tailLastReply: null,
    })
    expect(r.truncated).toBe(true)
    const renderedTokens = Math.ceil(r.renderText.length / 4)
    expect(renderedTokens).toBeLessThanOrEqual(600)
    // u29 is the cutoff itself (kept verbatim, not projected); the newest
    // PROJECTED prompt is u28
    expect(r.renderText).toContain("prompt number 28")
    expect(r.renderText).not.toContain("prompt number 0 ")
  })

  test("touched files edited after the swap epoch do not leak into the frozen render", () => {
    const msgs = [
      msg("u1", "user", [{ type: "text", text: "p1" }]),
      msg("a1", "assistant", [{ type: "text", text: "r1" }]),
      msg("u2", "user", [{ type: "text", text: "p2" }]),
    ]
    const r = projectRollover({
      msgs,
      cutoffId: "u2",
      epoch: 1,
      cfg,
      lines: [],
      touchedFiles: {
        "src/before.ts": { epoch: 1, turn: 1 },
        "src/after.ts": { epoch: 3, turn: 2 },
      },
      tailLastReply: null,
    })
    expect(r.renderText).toContain("- src/before.ts")
    expect(r.renderText).not.toContain("- src/after.ts")
  })
})

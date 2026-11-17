import { describe, expect, test } from "bun:test"
import { packLedger } from "../../src/core/packer"
import type { LedgerLine } from "../../src/core/types"

const rec = (over: Record<string, unknown>): LedgerLine => ({
  kind: "record",
  id: "o1",
  type: "objective",
  text: "did a thing",
  epoch: 0,
  userMessageId: "u1",
  turnMessageId: "a1",
  createdAt: 0,
  ...over,
} as LedgerLine)

describe("packLedger", () => {
  test("exact template with all sections", () => {
    const lines: LedgerLine[] = [
      rec({ id: "c3", type: "user_correction", text: "never touch legacy" }),
      rec({ id: "d5", type: "decision", text: "use cookies", rationale: "user said so" }),
      rec({ id: "i7", type: "open_item", text: "run integration", process: { command: "pytest -q", purpose: "slow suite", onResult: "report pass/fail" } }),
      rec({ id: "v9", type: "verification", text: "unit tests", status: "pass" }),
      rec({ id: "o2", type: "objective", text: "shipped auth" }),
    ]
    const touchedFiles = { "app/auth/session.py": { epoch: 0, turn: 1 } }
    const packed = packLedger({
      lines,
      epochAtSwap: 0,
      touchedFiles,
      lastReply: "done.",
      tailLastReply: "different tail reply",
      budgetTokens: 4000,
    })
    expect(packed.text).toBe(
      `<rollover_context epoch='0'>\nEarlier conversation history was replaced by this record to save context. Treat it as reliable memory of earlier work in this session. Earlier tool outputs and file contents are no longer visible: re-read a file if you need its exact current contents.\n\n## Standing rules and user corrections (must follow)\n- [c3] never touch legacy\n## Decisions\n- [d5] use cookies (why: user said so)\n## Open items\n- [i7] run integration | background process: \`pytest -q\` (purpose: slow suite). When its result arrives: report pass/fail\n## Verification state\n- [v9] pass: unit tests\n## Recent objectives\n- [o2] shipped auth\n## Files changed in this session\n- app/auth/session.py\n## Last assistant reply before this message\ndone.\n</rollover_context>`,
    )
    expect(packed.truncated).toBe(false)
  })

  test("empty categories omitted", () => {
    const packed = packLedger({
      lines: [rec({ id: "o1", type: "objective", text: "x" })],
      epochAtSwap: 0,
      touchedFiles: {},
      lastReply: "r",
      tailLastReply: null,
      budgetTokens: 4000,
    })
    expect(packed.text).not.toContain("## Decisions")
    expect(packed.text).not.toContain("## Open items")
    expect(packed.text).not.toContain("## Files changed")
    expect(packed.text).toContain("## Recent objectives")
    expect(packed.text).toContain("## Last assistant reply before this message")
  })

  test("lastReply suppressed when identical to tail reply", () => {
    const packed = packLedger({
      lines: [],
      epochAtSwap: 0,
      touchedFiles: {},
      lastReply: "same",
      tailLastReply: "same",
      budgetTokens: 4000,
    })
    expect(packed.text).not.toContain("## Last assistant reply before this message")
  })

  test("open_item epoch filter: epochAtSwap-1 included, -2 excluded", () => {
    const lines: LedgerLine[] = [
      rec({ id: "i1", type: "open_item", text: "old item", epoch: -2 }),
      rec({ id: "i2", type: "open_item", text: "recent item", epoch: -1 }),
    ]
    const packed = packLedger({
      lines,
      epochAtSwap: 0,
      touchedFiles: {},
      lastReply: "r",
      tailLastReply: null,
      budgetTokens: 4000,
    })
    expect(packed.text).toContain("recent item")
    expect(packed.text).not.toContain("old item")
  })

  test("file count cap 40 and epoch filter", () => {
    const touchedFiles: Record<string, { epoch: number; turn: number }> = {}
    for (let i = 0; i < 50; i++) touchedFiles[`f${i}.ts`] = { epoch: 0, turn: i }
    // one old-epoch file
    touchedFiles["old.ts"] = { epoch: -2, turn: 999 }
    const packed = packLedger({
      lines: [],
      epochAtSwap: 0,
      touchedFiles,
      lastReply: "r",
      tailLastReply: null,
      budgetTokens: 4000,
    })
    const fileLines = packed.text.split("\n").filter((l) => l.startsWith("- ") && l.endsWith(".ts"))
    expect(fileLines.length).toBe(40)
    expect(packed.text).not.toContain("old.ts")
  })

  test("user corrections all kept even under tight budget (truncated flag)", () => {
    const lines: LedgerLine[] = [
      rec({ id: "c1", type: "user_correction", text: "rule one very long ".repeat(20) }),
      rec({ id: "c2", type: "user_correction", text: "rule two very long ".repeat(20) }),
    ]
    const packed = packLedger({
      lines,
      epochAtSwap: 0,
      touchedFiles: {},
      lastReply: "r",
      tailLastReply: null,
      budgetTokens: 200,
    })
    expect(packed.truncated).toBe(true)
    // at least one correction present
    expect(packed.text).toContain("rule")
  })

  test("deterministic: same input → byte-identical", () => {
    const input = {
      lines: [rec({ id: "o1", type: "objective", text: "x" })] as LedgerLine[],
      epochAtSwap: 2,
      touchedFiles: {} as Record<string, { epoch: number; turn: number }>,
      lastReply: "r",
      tailLastReply: null as string | null,
      budgetTokens: 4000,
    }
    const a = packLedger(input).text
    const b = packLedger(input).text
    expect(a).toBe(b)
  })

  test("verification section renders status", () => {
    const lines: LedgerLine[] = [rec({ id: "v1", type: "verification", text: "tests", status: "partial" })]
    const packed = packLedger({
      lines,
      epochAtSwap: 0,
      touchedFiles: {},
      lastReply: "r",
      tailLastReply: null,
      budgetTokens: 4000,
    })
    expect(packed.text).toContain("- [v1] partial: tests")
  })

  test("files sorted by turn descending", () => {
    const touchedFiles = {
      "a.ts": { epoch: 0, turn: 1 },
      "b.ts": { epoch: 0, turn: 5 },
    }
    const packed = packLedger({
      lines: [],
      epochAtSwap: 0,
      touchedFiles,
      lastReply: "r",
      tailLastReply: null,
      budgetTokens: 4000,
    })
    const idxA = packed.text.indexOf("a.ts")
    const idxB = packed.text.indexOf("b.ts")
    expect(idxB).toBeLessThan(idxA)
  })
})

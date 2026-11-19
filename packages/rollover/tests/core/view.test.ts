import { describe, expect, test } from "bun:test"
import { buildViewPlan, hasOpenTools, freezeRollover } from "../../src/core/view"
import type { NMessage } from "../../src/core/types"
import type { SessionState, RolloverConfig } from "../../src/core/types"

const cfg = { renderBudgetTokens: 4000, tailN: 2, tailMaxN: 20 } as unknown as RolloverConfig

function msg(id: string, role: "user" | "assistant", parts: NMessage["parts"] = [{ type: "text", text: "x" }]): NMessage {
  return { id, role, parts, createdAt: 0 }
}

function baseState(over: Partial<SessionState> = {}): SessionState {
  return {
    v: 1,
    sessionId: "s1",
    settings: {},
    epoch: 0,
    extractedUntilMessageId: "a1",
    lastContextTokens: 200000,
    lastContextSource: "usage",
    lastContextAt: 0,
    rollover: null,
    decidedUserMessageIds: [],
    consolidatedAtRecordCount: 0,
    touchedFiles: {},
    ...over,
  }
}

describe("hasOpenTools", () => {
  test("pending tool → true", () => {
    expect(hasOpenTools([msg("a1", "assistant", [{ type: "tool", tool: "bash", status: "pending" }])])).toBe(true)
  })
  test("completed tool → false", () => {
    expect(hasOpenTools([msg("a1", "assistant", [{ type: "tool", tool: "bash", status: "completed" }])])).toBe(false)
  })
  test("running tool → true", () => {
    expect(hasOpenTools([msg("a1", "assistant", [{ type: "tool", tool: "bash", status: "running" }])])).toBe(true)
  })
})

describe("buildViewPlan", () => {
  test("cutoff found: tail + cutoff onward", () => {
    const msgs = [msg("u1", "user"), msg("a1", "assistant"), msg("u2", "user"), msg("a2", "assistant")]
    const rec = freezeRollover({ msgs, st: baseState(), cfg, lines: [], userMessageId: "u2" })
    const plan = buildViewPlan(msgs, rec)
    expect(plan).not.toBeNull()
    expect(plan!.prependText).toContain("<rollover_context")
    // items: tail (u1+a1) + cutoff onward (u2,a2)
    expect(plan!.items.length).toBe(4)
    expect(plan!.items[0].textOnly).toBe(true)
    expect(plan!.items[2].textOnly).toBe(false)
  })

  test("cutoff missing → null", () => {
    const msgs = [msg("u1", "user")]
    const rec = freezeRollover({ msgs: [msg("u1", "user"), msg("u2", "user")], st: baseState(), cfg, lines: [], userMessageId: "u2" })
    const plan = buildViewPlan(msgs, rec)
    expect(plan).toBeNull()
  })

  test("consecutive same role tolerated (harness sends multi-assistant steps)", () => {
    // Live 2.x primary requests legitimately contain consecutive assistant
    // messages (step/fingerprint assistant rows); the plan must not reject them.
    const rec = freezeRollover({ msgs: [msg("u1", "user"), msg("u1b", "assistant", [{ type: "text", text: "r" }]), msg("u2", "user")], st: baseState(), cfg, lines: [], userMessageId: "u2" })
    const plan = buildViewPlan([msg("u1", "user"), msg("u2", "user"), msg("a2", "assistant"), msg("a2b", "assistant")], rec)
    expect(plan).not.toBeNull()
    expect(plan!.items.map((i) => i.srcIndex)).toEqual([0, 1, 2, 3])
  })

  test("textOnly keeps only text parts (tool/reasoning dropped)", () => {
    const msgs = [msg("u1", "user", [{ type: "text", text: "q" }]), msg("a1", "assistant", [{ type: "text", text: "r" }, { type: "tool", tool: "bash", status: "completed", output: "x" }]), msg("u2", "user")]
    const rec = freezeRollover({ msgs: [msg("u1", "user", [{ type: "text", text: "q" }]), msg("a1", "assistant", [{ type: "text", text: "r" }]), msg("u2", "user")], st: baseState(), cfg, lines: [], userMessageId: "u2" })
    const plan = buildViewPlan(msgs, rec)
    expect(plan).not.toBeNull()
    expect(plan!.items[1].textOnly).toBe(true)
  })

  test("idempotent: same plan on repeated call", () => {
    const msgs = [msg("u1", "user"), msg("a1", "assistant"), msg("u2", "user")]
    const rec = freezeRollover({ msgs, st: baseState(), cfg, lines: [], userMessageId: "u2" })
    const p1 = buildViewPlan(msgs, rec)
    const p2 = buildViewPlan(msgs, rec)
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2))
  })

  test("does not mutate input", () => {
    const msgs = [msg("u1", "user"), msg("u2", "user")]
    const before = JSON.stringify(msgs)
    const rec = freezeRollover({ msgs, st: baseState(), cfg, lines: [], userMessageId: "u2" })
    buildViewPlan(msgs, rec)
    expect(JSON.stringify(msgs)).toBe(before)
  })

  test("freezeRollover sets cutoffMessageId and tailMessageIds", () => {
    const msgs = [msg("u1", "user"), msg("a1", "assistant"), msg("u2", "user")]
    const rec = freezeRollover({ msgs, st: baseState(), cfg, lines: [], userMessageId: "u2" })
    expect(rec.cutoffMessageId).toBe("u2")
    expect(rec.tailMessageIds).toContain("u1")
    expect(rec.tokensBefore).toBe(200000)
  })

  test("freezeRollover renders the mechanical projection (prompts verbatim, no LLM)", () => {
    const msgs = [
      msg("u1", "user", [{ type: "text", text: "add settings endpoint" }]),
      msg("a1", "assistant", [{ type: "text", text: "Done." }]),
      msg("u2", "user", [{ type: "text", text: "also fix tests" }]),
    ]
    const rec = freezeRollover({ msgs, st: baseState(), cfg, lines: [], userMessageId: "u2" })
    expect(rec.renderText).toContain("## User prompts")
    expect(rec.renderText).toContain("- [u1] add settings endpoint")
    expect(rec.renderText).toContain("<rollover_context epoch='0'>")
  })

  test("tailN: 0 keeps no tail messages", () => {
    const msgs = [msg("u1", "user"), msg("a1", "assistant"), msg("u2", "user")]
    const rec = freezeRollover({ msgs, st: baseState({ settings: { tailN: 0 } }), cfg, lines: [], userMessageId: "u2" })
    expect(rec.tailMessageIds).toEqual([])
    const plan = buildViewPlan(msgs, rec)
    expect(plan).not.toBeNull()
    expect(plan!.items.map((i) => i.srcIndex)).toEqual([2])
  })
})

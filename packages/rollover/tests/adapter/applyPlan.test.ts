import { describe, expect, test } from "bun:test"
import { applyPlan } from "../../src/adapter/opencode/applyPlan"
import type { ViewPlan } from "../../src/core/view"

function msg(id: string, role: "user" | "assistant", parts: unknown[]): any {
  return { id, role, content: parts }
}

describe("applyPlan", () => {
  test("returns a new array of plan.items length", () => {
    const raw = [msg("u1", "user", [{ type: "text", text: "q" }]), msg("u2", "user", [{ type: "text", text: "r" }])]
    const plan: ViewPlan = { items: [{ srcIndex: 0, textOnly: true }, { srcIndex: 1, textOnly: false }], prependText: "CTX" }
    const out = applyPlan(raw, plan, { sessionID: "ses1" })
    expect(out).not.toBe(raw)
    expect(out.length).toBe(2)
  })

  test("does not mutate input", () => {
    const raw = [msg("u1", "user", [{ type: "text", text: "q" }])]
    const before = JSON.stringify(raw)
    const plan: ViewPlan = { items: [{ srcIndex: 0, textOnly: true }], prependText: "CTX" }
    applyPlan(raw, plan, { sessionID: "ses1" })
    expect(JSON.stringify(raw)).toBe(before)
  })

  test("textOnly items keep only text parts", () => {
    const raw = [msg("u1", "user", [{ type: "text", text: "q" }, { type: "tool", tool: "bash", status: "completed" }])]
    const plan: ViewPlan = { items: [{ srcIndex: 0, textOnly: true }], prependText: "CTX" }
    const out = applyPlan(raw, plan, { sessionID: "ses1" }) as any[]
    expect(out[0].content).toEqual([{ type: "text", text: "CTX" }, { type: "text", text: "q" }])
  })

  test("synthetic context part prepended to first item", () => {
    const raw = [msg("u1", "user", [{ type: "text", text: "q" }])]
    const plan: ViewPlan = { items: [{ srcIndex: 0, textOnly: false }], prependText: "CTX" }
    const out = applyPlan(raw, plan, { sessionID: "ses1" }) as any[]
    expect(out[0].content[0]).toMatchObject({ type: "text", text: "CTX" })
    expect(out[0].content[1]).toMatchObject({ type: "text", text: "q" })
  })

  test("repeated application to the same raw input stays stable", () => {
    const raw = [msg("u1", "user", [{ type: "text", text: "q" }])]
    const plan: ViewPlan = { items: [{ srcIndex: 0, textOnly: false }], prependText: "CTX" }
    const out1 = applyPlan(raw, plan, { sessionID: "ses1" })
    const out2 = applyPlan(raw, plan, { sessionID: "ses1" })
    expect(JSON.stringify(out1)).toBe(JSON.stringify(out2))
  })
})

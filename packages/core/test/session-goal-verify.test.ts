import { describe, expect, it } from "bun:test"
import { SessionGoalVerify } from "@opencode/core/session/goal-verify"
import type { SessionGoal } from "@opencode/schema/session-goal"

const todo = (overrides: Partial<SessionGoal.TodoItem>): SessionGoal.TodoItem => ({
  position: 0,
  content: "first",
  status: "pending",
  ...overrides,
})

const verdict = (overrides: Partial<SessionGoalVerify.Verdict>): SessionGoalVerify.Verdict => ({
  verdict: "complete",
  unmet: [],
  evidence: "tests pass",
  ...overrides,
})

describe("SessionGoalVerify.parseVerdict", () => {
  it("decodes a bare answer", () => {
    expect(SessionGoalVerify.parseVerdict('{"verdict":"complete","unmet":[],"evidence":"tests pass"}')).toEqual({
      verdict: "complete",
      unmet: [],
      evidence: "tests pass",
    })
  })

  it("decodes an answer wrapped in prose and a code fence", () => {
    expect(
      SessionGoalVerify.parseVerdict('Here you go:\n```json\n{"verdict":"incomplete","unmet":[],"evidence":"none"}\n```'),
    ).toEqual({ verdict: "incomplete", unmet: [], evidence: "none" })
  })

  it("fails closed on prose", () => {
    expect(SessionGoalVerify.parseVerdict("looks done to me")).toBeUndefined()
  })

  it("fails closed on a structurally invalid answer", () => {
    expect(SessionGoalVerify.parseVerdict('{"verdict":"maybe"}')).toBeUndefined()
    expect(SessionGoalVerify.parseVerdict('{"verdict":"complete","unmet":[{"position":"first"}],"evidence":""}')).toBeUndefined()
  })
})

describe("SessionGoalVerify.applyVerdict", () => {
  it("completes every open item on a complete verdict", () => {
    const items = SessionGoalVerify.applyVerdict(
      [todo({}), todo({ position: 1, status: "in_progress" })],
      verdict({}),
    )
    expect(items).toEqual([
      { position: 0, status: "completed", feedback: "" },
      { position: 1, status: "completed", feedback: "" },
    ])
    expect(items.every(SessionGoalVerify.isSettled)).toBe(true)
  })

  it("keeps an unmet item open with the verifier's own reason", () => {
    const items = SessionGoalVerify.applyVerdict(
      [todo({}), todo({ position: 1 })],
      verdict({ unmet: [{ position: 1, reason: "no test output" }] }),
    )
    expect(items).toEqual([
      { position: 0, status: "completed", feedback: "" },
      { position: 1, status: "pending", feedback: "no test output" },
    ])
    expect(items.every(SessionGoalVerify.isSettled)).toBe(false)
  })

  it("fails closed: an incomplete verdict completes nothing", () => {
    const items = SessionGoalVerify.applyVerdict([todo({})], verdict({ verdict: "incomplete" }))
    expect(items).toEqual([{ position: 0, status: "pending", feedback: "" }])
    expect(items.every(SessionGoalVerify.isSettled)).toBe(false)
  })

  it("fails closed: no verdict completes nothing", () => {
    const items = SessionGoalVerify.applyVerdict([todo({})], undefined)
    expect(items).toEqual([{ position: 0, status: "pending", feedback: "" }])
    expect(items.every(SessionGoalVerify.isSettled)).toBe(false)
  })

  it("leaves a cancelled item settled", () => {
    const items = SessionGoalVerify.applyVerdict([todo({ status: "cancelled" })], verdict({}))
    expect(items).toEqual([{ position: 0, status: "cancelled", feedback: "" }])
    expect(items.every(SessionGoalVerify.isSettled)).toBe(true)
  })
})

describe("SessionGoalVerify.isComplete", () => {
  it("does not complete an empty list", () => {
    expect(SessionGoalVerify.isComplete([], verdict({}))).toBe(false)
  })

  it("completes a non-empty settled list on a complete verdict", () => {
    expect(SessionGoalVerify.isComplete([{ position: 0, status: "completed", feedback: "" }], verdict({}))).toBe(true)
  })

  it("does not complete on an incomplete verdict", () => {
    expect(
      SessionGoalVerify.isComplete([{ position: 0, status: "completed", feedback: "" }], verdict({ verdict: "incomplete" })),
    ).toBe(false)
  })
})

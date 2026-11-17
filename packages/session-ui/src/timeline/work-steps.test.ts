import { describe, expect, test } from "bun:test"
import {
  defaultWorkSteps,
  emptyWorkStepDisclosure,
  setWorkPhaseOpen,
  setWorkTurnOpen,
  workPhaseOpen,
  workReplyVisible,
  workStepPolicy,
  workTurnOpen,
  type WorkStepCollapseTiming,
  type WorkStepFoldedReplies,
  type WorkStepPhase,
  type WorkStepTurn,
} from "./work-steps"

const timings: WorkStepCollapseTiming[] = ["completion", "next-input"]

const replies: WorkStepFoldedReplies[] = ["all", "final"]

const completed: WorkStepTurn = {
  sessionID: "session-a",
  turnID: "turn-1",
  status: "completed",
  latestCompletedTurn: true,
  hasLaterInput: false,
}

const phase: WorkStepPhase = {
  sessionID: "session-a",
  turnID: "turn-1",
  phaseID: "response-1",
  status: "completed",
}

describe("work step policy", () => {
  test("uses the DSH-compatible defaults", () => {
    expect(defaultWorkSteps).toEqual({
      view: "standard",
      collapseTiming: "completion",
      foldedReplies: "all",
    })
  })

  test.each([
    ["compact", true, "always"],
    ["standard", true, "always"],
    ["detailed", true, "completed"],
    ["verbose", false, "never"],
  ] as const)("%s derives its folding policy", (view, foldCompletedTurns, groupActivity) => {
    expect(workStepPolicy({ view, collapseTiming: "completion", foldedReplies: "all" })).toEqual({
      view,
      collapseTiming: "completion",
      foldedReplies: "all",
      foldCompletedTurns,
      liveProcessDetail: view === "standard" || view === "detailed",
      settledReasoningPreview: view !== "compact",
      groupActivity,
    })
  })
})

describe("whole-turn disclosure", () => {
  test.each(["live", "error", "interrupted"] as const)("%s turns always stay open", (status) => {
    const turn = { ...completed, status }

    expect(workTurnOpen(workStepPolicy(defaultWorkSteps), turn)).toBe(true)
    expect(
      workTurnOpen(workStepPolicy(defaultWorkSteps), turn, setWorkTurnOpen(emptyWorkStepDisclosure, turn, false)),
    ).toBe(true)
  })

  test.each(timings)("completed turns with %s timing use their timing default", (collapseTiming) => {
    const policy = workStepPolicy({ ...defaultWorkSteps, collapseTiming })

    expect(workTurnOpen(policy, completed)).toBe(collapseTiming === "next-input")
    expect(workTurnOpen(policy, { ...completed, hasLaterInput: true })).toBe(false)
    expect(workTurnOpen(policy, { ...completed, latestCompletedTurn: false })).toBe(false)
  })

  test("verbose never folds a completed turn", () => {
    expect(
      workTurnOpen(workStepPolicy({ view: "verbose", collapseTiming: "completion", foldedReplies: "all" }), completed),
    ).toBe(true)
  })

  test("manual choices override both timings without crossing sessions or turns", () => {
    const completion = workStepPolicy({ ...defaultWorkSteps, collapseTiming: "completion" })
    const nextInput = workStepPolicy({ ...defaultWorkSteps, collapseTiming: "next-input" })
    const first = completed
    const second = { ...completed, turnID: "turn-2", latestCompletedTurn: false }
    const otherSession = { ...completed, sessionID: "session-b" }

    const firstOpen = setWorkTurnOpen(emptyWorkStepDisclosure, first, true)
    const firstClosed = setWorkTurnOpen(firstOpen, first, false)
    const secondOpen = setWorkTurnOpen(firstClosed, second, true)
    const otherOpen = setWorkTurnOpen(secondOpen, otherSession, true)

    expect(workTurnOpen(completion, first, firstOpen)).toBe(true)
    expect(workTurnOpen(completion, first, firstClosed)).toBe(false)
    expect(workTurnOpen(nextInput, second, secondOpen)).toBe(true)
    expect(workTurnOpen(completion, otherSession, otherOpen)).toBe(true)
    expect(workTurnOpen(completion, { ...otherSession, turnID: "turn-2" }, otherOpen)).toBe(false)
    expect(emptyWorkStepDisclosure).toEqual({})
  })
})

describe("activity phase disclosure", () => {
  test.each([
    ["compact", "completed", false],
    ["compact", "live", false],
    ["standard", "completed", false],
    ["standard", "live", false],
    ["detailed", "completed", false],
    ["detailed", "live", true],
    ["verbose", "completed", true],
    ["verbose", "live", true],
  ] as const)("%s phases that are %s start with the expected disclosure", (view, status, open) => {
    const policy = workStepPolicy({ ...defaultWorkSteps, view })

    expect(workPhaseOpen(policy, { ...phase, status })).toBe(open)
  })

  test("phase choices are independent from the whole turn, sibling phases, turns and sessions", () => {
    const policy = workStepPolicy(defaultWorkSteps)
    const sibling = { ...phase, phaseID: "response-2" }
    const nextTurn = { ...phase, turnID: "turn-2" }
    const otherSession = { ...phase, sessionID: "session-b" }
    const state = setWorkPhaseOpen(emptyWorkStepDisclosure, phase, true)

    expect(workPhaseOpen(policy, phase, state)).toBe(true)
    expect(workPhaseOpen(policy, sibling, state)).toBe(false)
    expect(workPhaseOpen(policy, nextTurn, state)).toBe(false)
    expect(workPhaseOpen(policy, otherSession, state)).toBe(false)
    expect(workTurnOpen(policy, completed, state)).toBe(false)
  })

  test("manual closing overrides defaults that are open", () => {
    const detailed = workStepPolicy({ ...defaultWorkSteps, view: "detailed" })
    const verbose = workStepPolicy({ ...defaultWorkSteps, view: "verbose" })
    const closed = setWorkPhaseOpen(emptyWorkStepDisclosure, phase, false)

    expect(workPhaseOpen(detailed, { ...phase, status: "live" }, closed)).toBe(false)
    expect(workPhaseOpen(verbose, phase, closed)).toBe(false)
  })
})

describe("folded replies", () => {
  test.each(replies)("%s reply mode keeps live intermediate replies visible", (foldedReplies) => {
    const policy = workStepPolicy({ ...defaultWorkSteps, foldedReplies })

    expect(workReplyVisible(policy, { kind: "intermediate", status: "live" }, false)).toBe(true)
  })

  test.each(replies)("%s reply mode always keeps final replies visible", (foldedReplies) => {
    const policy = workStepPolicy({ ...defaultWorkSteps, foldedReplies })

    expect(workReplyVisible(policy, { kind: "final", status: "completed" }, false)).toBe(true)
  })

  test("all keeps settled intermediate replies and final hides them only while the turn is folded", () => {
    const all = workStepPolicy({ ...defaultWorkSteps, foldedReplies: "all" })
    const final = workStepPolicy({ ...defaultWorkSteps, foldedReplies: "final" })
    const intermediate = { kind: "intermediate", status: "completed" } as const

    expect(workReplyVisible(all, intermediate, false)).toBe(true)
    expect(workReplyVisible(final, intermediate, false)).toBe(false)
    expect(workReplyVisible(final, intermediate, true)).toBe(true)
  })
})

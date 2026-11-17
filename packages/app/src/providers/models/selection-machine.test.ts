import { describe, expect, test } from "bun:test"
import {
  COMMIT_ACK_TIMEOUT_MS,
  createModelSelectionState,
  editSelection,
  selectPreview,
  selectSession,
  selectVariant,
  transitionModelSelection,
  type CommitTarget,
  type DurableSelection,
  type ModelChoice,
  type ModelSelectionEvent,
  type ModelSelectionState,
  type ModelSelectionTransition,
} from "./selection-machine"
import { DEFAULT_VARIANT, INHERIT_VARIANT } from "./variant"

const choice = (modelID: string, variant?: string): ModelChoice => ({
  providerID: "provider",
  modelID,
  variant: variant ? { type: "named", value: variant } : DEFAULT_VARIANT,
})

const target = (modelID: string, variant?: string, agent = "build"): CommitTarget => ({
  agent,
  model: { providerID: "provider", modelID },
  variant,
})

const durable = (modelID: string, variant?: string, agent = "build"): DurableSelection => ({
  agent,
  model: { providerID: "provider", id: modelID, variant },
})

const picked = (sessionID: string, modelID: string, variant?: string): ModelSelectionEvent => ({
  type: "edited",
  sessionID,
  edit: { type: "model", agent: "build", choice: choice(modelID, variant) },
})

function replay(state: ModelSelectionState, events: ModelSelectionEvent[]): ModelSelectionTransition {
  return events.reduce<ModelSelectionTransition>(
    (result, event) => {
      const next = transitionModelSelection(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

const ready = () => createModelSelectionState({ status: "ready", sessions: {} })

describe("model selection machine", () => {
  test("a promoted Session is written to its workspace at once, with no visit, and deletion removes it", () => {
    const promoted = replay(ready(), [
      {
        type: "session.promoted",
        sessionID: "ses_wt",
        selection: { agent: "plan", choice: choice("b", "high"), choices: {} },
        durable: undefined,
      },
    ])

    expect(selectSession(promoted.state, "ses_wt")).toMatchObject({ agent: "plan", choice: choice("b", "high") })
    expect(promoted.effects).toEqual([
      {
        type: "persist.write",
        sessionID: "ses_wt",
        selection: { agent: "plan", choice: choice("b", "high"), choices: {} },
      },
    ])

    const deleted = transitionModelSelection(promoted.state, { type: "session.deleted", sessionID: "ses_wt" })
    expect(selectSession(deleted.state, "ses_wt")).toBeUndefined()
    expect(deleted.effects).toEqual([{ type: "persist.write", sessionID: "ses_wt", selection: undefined }])
  })

  test("a promotion the create request already committed keeps only agent memory", () => {
    const choices = { build: choice("c", "low") }

    const next = transitionModelSelection(ready(), {
      type: "session.promoted",
      sessionID: "ses_a",
      selection: { agent: "plan", choice: choice("b"), choices },
      durable: durable("b", undefined, "plan"),
    })

    expect(selectSession(next.state, "ses_a")).toEqual({ phase: "committed", choices })
  })

  test("selections made while stored ones load win, are written once loaded, and deletions stay deleted", () => {
    const loading = replay(createModelSelectionState({ status: "hydrating" }), [
      {
        type: "session.promoted",
        sessionID: "ses_wt",
        selection: { agent: "plan", choice: choice("b"), choices: {} },
        durable: undefined,
      },
      { type: "session.deleted", sessionID: "ses_gone" },
    ])

    expect(loading.effects).toEqual([])

    const loaded = transitionModelSelection(loading.state, {
      type: "hydrated",
      sessions: {
        ses_wt: { agent: "build", choice: choice("a"), choices: {} },
        ses_gone: { agent: "build", choices: {} },
        ses_other: { agent: "build", choice: choice("c"), choices: {} },
      },
    })

    expect(selectSession(loaded.state, "ses_wt")).toMatchObject({ agent: "plan", choice: choice("b") })
    expect(selectSession(loaded.state, "ses_other")).toMatchObject({ agent: "build", choice: choice("c") })
    expect(selectSession(loaded.state, "ses_gone")).toBeUndefined()
    expect(loaded.effects).toEqual([
      { type: "persist.write", sessionID: "ses_wt", selection: { agent: "plan", choice: choice("b"), choices: {} } },
      { type: "persist.write", sessionID: "ses_gone", selection: undefined },
    ])
    expect(transitionModelSelection(loaded.state, { type: "hydrated", sessions: {} }).state).toBe(loaded.state)
  })

  test("a local edit ends the commit wait, so a late echo of the old commit keeps the unsent selection", () => {
    const result = replay(ready(), [
      picked("ses_a", "a", "high"),
      { type: "commit.tracked", sessionID: "ses_a", target: target("a", "high"), visible: true, durable: undefined },
      picked("ses_a", "b", "low"),
      picked("ses_a", "a", "high"),
      { type: "commit.reconciled", sessionID: "ses_a", visible: true, durable: durable("a", "high") },
    ])

    expect(selectSession(result.state, "ses_a")).toMatchObject({ phase: "override", choice: choice("a", "high") })
    expect(result.effects.filter((effect) => effect.type.startsWith("ack-timer"))).toEqual([
      { type: "ack-timer.start", sessionID: "ses_a", attempt: 1, timeoutMs: COMMIT_ACK_TIMEOUT_MS },
      { type: "ack-timer.clear", sessionID: "ses_a" },
    ])
  })

  test("a commit the server never echoes stops waiting after the timeout and keeps the selection", () => {
    const tracked = replay(ready(), [
      picked("ses_a", "a", "high"),
      { type: "commit.tracked", sessionID: "ses_a", target: target("a", "high"), visible: true, durable: undefined },
    ])

    const timedOut = replay(tracked.state, [
      { type: "commit.timed-out", sessionID: "ses_a", attempt: 1 },
      { type: "commit.reconciled", sessionID: "ses_a", visible: true, durable: durable("a", "high") },
    ])

    expect(selectSession(timedOut.state, "ses_a")).toMatchObject({ phase: "override", choice: choice("a", "high") })
  })

  test("a stale cancel or timeout leaves a newer commit waiting", () => {
    const second = replay(ready(), [
      picked("ses_a", "a", "high"),
      { type: "commit.tracked", sessionID: "ses_a", target: target("a", "high"), visible: true, durable: undefined },
      picked("ses_a", "b", "low"),
      { type: "commit.tracked", sessionID: "ses_a", target: target("b", "low"), visible: true, durable: undefined },
    ])

    expect(selectSession(second.state, "ses_a")).toMatchObject({ phase: "awaiting-ack", attempt: 2 })
    expect(
      transitionModelSelection(second.state, { type: "commit.cancelled", sessionID: "ses_a", attempt: 1 }),
    ).toEqual({ state: second.state, effects: [] })
    expect(
      transitionModelSelection(second.state, { type: "commit.timed-out", sessionID: "ses_a", attempt: 1 }).state,
    ).toBe(second.state)

    const cancelled = transitionModelSelection(second.state, {
      type: "commit.cancelled",
      sessionID: "ses_a",
      attempt: 2,
    })

    expect(selectSession(cancelled.state, "ses_a")).toMatchObject({ phase: "override", choice: choice("b", "low") })
    expect(cancelled.effects).toContainEqual({ type: "ack-timer.clear", sessionID: "ses_a" })
  })

  test.each([
    { name: "on screen it shows the committed selection and keeps agent memory", visible: true, phase: "committed" },
    { name: "off screen it keeps the local selection", visible: false, phase: "override" },
  ])("an echoed commit $name", ({ visible, phase }) => {
    const result = replay(ready(), [
      {
        type: "edited",
        sessionID: "ses_a",
        edit: { type: "agent", agent: "plan", previous: { agent: "build", choice: choice("c") } },
      },
      { type: "edited", sessionID: "ses_a", edit: { type: "model", agent: "plan", choice: choice("a", "high") } },
      {
        type: "commit.tracked",
        sessionID: "ses_a",
        target: target("a", "high", "plan"),
        visible,
        durable: durable("b", "low"),
      },
      { type: "commit.reconciled", sessionID: "ses_a", visible, durable: durable("b", "low", "plan") },
    ])

    expect(selectSession(result.state, "ses_a")).toMatchObject({ phase: "awaiting-ack" })

    const echoed = transitionModelSelection(result.state, {
      type: "commit.reconciled",
      sessionID: "ses_a",
      visible,
      durable: durable("a", "high", "plan"),
    })

    expect(selectSession(echoed.state, "ses_a")).toMatchObject({ phase, choices: { build: choice("c") } })
  })

  test("an already committed selection releases a matching override without waiting", () => {
    const result = replay(ready(), [
      picked("ses_a", "a", "high"),
      {
        type: "commit.tracked",
        sessionID: "ses_a",
        target: target("a", "high"),
        visible: true,
        durable: durable("a", "high"),
      },
    ])

    expect(selectSession(result.state, "ses_a")).toBeUndefined()
    expect(result.effects.some((effect) => effect.type === "ack-timer.start")).toBe(false)
  })

  test("history restores a selection only for the shown Session without one", () => {
    const restore = (state: ModelSelectionState, visible: boolean, session?: DurableSelection) =>
      transitionModelSelection(state, {
        type: "session.restored",
        sessionID: "ses_a",
        visible,
        durable: session,
        agent: "plan",
        choice: choice("b", "low"),
      }).state

    const empty = ready()
    expect(restore(empty, false)).toBe(empty)
    expect(selectSession(restore(ready(), true, durable("a")), "ses_a")).toBeUndefined()
    const restored = restore(ready(), true)
    expect(selectSession(restored, "ses_a")).toMatchObject({ agent: "plan", choice: choice("b", "low") })
    expect(restore(restored, true)).toBe(restored)
  })

  test("disposal stops every timer and ignores later events", () => {
    const disposed = transitionModelSelection(ready(), { type: "disposed" })
    expect(disposed.effects).toEqual([{ type: "ack-timer.clear-all" }])
    expect(transitionModelSelection(disposed.state, picked("ses_a", "a")).state).toBe(disposed.state)
  })

  test("switching agents remembers the model left behind and restores the one returned to", () => {
    const first = editSelection(undefined, {
      type: "agent",
      agent: "plan",
      previous: { agent: "build", choice: choice("c", "high") },
    })

    const back = editSelection(first, {
      type: "agent",
      agent: "build",
      previous: { agent: "plan", choice: choice("b") },
    })

    expect(back).toEqual({
      agent: "build",
      choice: choice("c", "high"),
      choices: { build: choice("c", "high"), plan: choice("b") },
    })
    expect(editSelection(back, { type: "agent", agent: "build", previous: { agent: "build" } })).toBe(back)
  })

  test("the variant and preview follow the local choice, then the durable model of the same agent", () => {
    const valid = () => true
    const local = { agent: "build", choice: { ...choice("a"), variant: INHERIT_VARIANT }, choices: {} }

    expect(selectVariant(local, durable("b", "high"), "build", valid)).toEqual(INHERIT_VARIANT)
    expect(selectVariant(undefined, durable("b", "high"), "build", valid)).toEqual({ type: "named", value: "high" })
    expect(selectVariant(undefined, durable("b"), "build", valid)).toEqual(DEFAULT_VARIANT)
    expect(selectVariant(undefined, durable("b", "high"), "plan", valid)).toEqual(INHERIT_VARIANT)
    expect(selectPreview(undefined, durable("b", "high"))).toEqual({
      model: { providerID: "provider", modelID: "b" },
      selected: { type: "named", value: "high" },
    })
    expect(selectPreview({ agent: "plan", choices: {} }, durable("b", "high"))).toBeUndefined()
  })
})

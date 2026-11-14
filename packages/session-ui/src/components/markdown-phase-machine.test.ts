import { describe, expect, test } from "bun:test"
import {
  createMarkdownPhaseState,
  DISPOSED_MARKDOWN_PHASE_EVENT,
  DISPOSED_MARKDOWN_PHASE_STATE,
  markdownMode,
  markdownReady,
  transitionMarkdownPhase,
  type MarkdownPhaseEvent,
  type MarkdownPhaseState,
} from "./markdown-phase-machine"

function replay(events: MarkdownPhaseEvent[], state: MarkdownPhaseState) {
  return events.reduce(transitionMarkdownPhase, state)
}

const rendered = (pendingChecks = 0, reused = false): MarkdownPhaseEvent => ({
  type: "dom.rendered",
  rendered: true,
  pendingChecks,
  reused,
})

const stale: MarkdownPhaseEvent = { type: "dom.rendered", rendered: false, pendingChecks: 0, reused: false }

describe("transitionMarkdownPhase", () => {
  test("keeps a completed render ready through unrelated effect runs", () => {
    const ready = transitionMarkdownPhase(createMarkdownPhaseState(false), rendered())

    expect(markdownReady(ready)).toBe(true)
    // Before the machine, every rerun (a language, plugin or session title change) removed and re-added the attribute.
    expect(transitionMarkdownPhase(ready, rendered(0, true))).toBe(ready)
    expect(transitionMarkdownPhase(ready, rendered(1, true))).toBe(ready)
  })

  test("waits for the settled render after a stream ends instead of reporting the last live render", () => {
    const streaming = transitionMarkdownPhase(createMarkdownPhaseState(true), rendered())

    expect(streaming).toEqual({ status: "ready", mode: "streaming", attempts: 0 })

    const ended = transitionMarkdownPhase(streaming, { type: "props.sync", streaming: false })

    expect(ended).toEqual({ status: "pending", mode: "settled", attempts: 0 })
    expect(markdownReady(ended)).toBe(false)
    // The live render still matches the text, but the driver reports it as not rendered for the settled mode.
    expect(transitionMarkdownPhase(ended, stale)).toBe(ended)

    const checking = transitionMarkdownPhase(ended, rendered(1))

    expect(checking).toEqual({ status: "checking", mode: "settled", attempt: 1 })
    expect(transitionMarkdownPhase(checking, { type: "checks.settled", attempt: 1 })).toEqual({
      status: "ready",
      mode: "settled",
      attempts: 1,
    })
  })

  test("reports ready when an inline path check never settles", () => {
    const checking = transitionMarkdownPhase(createMarkdownPhaseState(false), rendered(1))

    expect(checking).toEqual({ status: "checking", mode: "static", attempt: 1 })
    expect(markdownReady(transitionMarkdownPhase(checking, { type: "checks.timed-out", attempt: 1 }))).toBe(true)
  })

  test("ignores checks of a replaced render and keeps a running check through unrelated reruns", () => {
    const first = transitionMarkdownPhase(createMarkdownPhaseState(false), rendered(1))

    expect(transitionMarkdownPhase(first, rendered(1, true))).toBe(first)

    const second = transitionMarkdownPhase(first, rendered(1))

    expect(second).toEqual({ status: "checking", mode: "static", attempt: 2 })
    expect(transitionMarkdownPhase(second, { type: "checks.settled", attempt: 1 })).toBe(second)
    expect(transitionMarkdownPhase(second, { type: "checks.timed-out", attempt: 1 })).toBe(second)
    expect(transitionMarkdownPhase(second, { type: "checks.settled", attempt: 2 })).toEqual({
      status: "ready",
      mode: "static",
      attempts: 2,
    })
  })

  test("leaves a check when the render goes stale or the text starts streaming", () => {
    const checking = transitionMarkdownPhase(createMarkdownPhaseState(false), rendered(1))
    const pending = transitionMarkdownPhase(checking, stale)

    expect(pending).toEqual({ status: "pending", mode: "static", attempts: 1 })
    expect(transitionMarkdownPhase(pending, { type: "checks.settled", attempt: 1 })).toBe(pending)
    // The next check gets a new attempt, so the first one cannot settle it.
    expect(transitionMarkdownPhase(pending, rendered(1, true))).toEqual({
      status: "checking",
      mode: "static",
      attempt: 2,
    })

    const streaming = transitionMarkdownPhase(checking, { type: "props.sync", streaming: true })

    expect(streaming).toEqual({ status: "pending", mode: "streaming", attempts: 1 })
    expect(transitionMarkdownPhase(streaming, { type: "checks.settled", attempt: 1 })).toBe(streaming)
  })

  test("never waits for path checks while streaming", () => {
    expect(transitionMarkdownPhase(createMarkdownPhaseState(true), rendered(2))).toEqual({
      status: "ready",
      mode: "streaming",
      attempts: 0,
    })
  })

  test("returns the same frozen states on every streamed delta", () => {
    const streaming = createMarkdownPhaseState(true)
    const ready = transitionMarkdownPhase(streaming, rendered())
    const sync: MarkdownPhaseEvent = { type: "props.sync", streaming: true }

    const states = Array.from({ length: 100 }, () => [
      transitionMarkdownPhase(ready, stale),
      transitionMarkdownPhase(streaming, rendered()),
      transitionMarkdownPhase(ready, sync),
    ]).flat()

    expect(Object.isFrozen(streaming) && Object.isFrozen(ready)).toBe(true)
    expect(states.every((state, index) => state === [streaming, ready, ready][index % 3])).toBe(true)
  })

  test("names the mode the driver disposes the worker projection by, and ignores events after disposal", () => {
    const fixed = transitionMarkdownPhase(createMarkdownPhaseState(false), rendered())
    const streamed = replay([rendered(), { type: "props.sync", streaming: false }], createMarkdownPhaseState(true))

    expect(markdownMode(fixed)).toBe("static")
    expect(markdownMode(streamed)).toBe("settled")
    expect(transitionMarkdownPhase(streamed, DISPOSED_MARKDOWN_PHASE_EVENT)).toBe(DISPOSED_MARKDOWN_PHASE_STATE)
    expect(transitionMarkdownPhase(DISPOSED_MARKDOWN_PHASE_STATE, rendered())).toBe(DISPOSED_MARKDOWN_PHASE_STATE)
    expect(transitionMarkdownPhase(DISPOSED_MARKDOWN_PHASE_STATE, { type: "props.sync", streaming: true })).toBe(
      DISPOSED_MARKDOWN_PHASE_STATE,
    )
  })
})

import { describe, expect, test } from "bun:test"
import {
  createReconnectState,
  DISPOSED_RECONNECT_EVENT,
  isReconnectObserverActive,
  transitionReconnect,
  type ReconnectEvent,
  type ReconnectState,
} from "./reconnect-machine"

const mutated = (connected: boolean, added: boolean, deadline = 100): ReconnectEvent => ({
  type: "mutated",
  connected,
  added,
  deadline,
})

const frame = (
  state: ReconnectState,
  time: number,
  nativeTop = 0,
  virtualOffset: number | null = 0,
): Extract<ReconnectEvent, { type: "frame" }> => ({
  type: "frame",
  attempt: attemptOf(state),
  time,
  connected: true,
  nativeTop,
  virtualOffset,
})

function attemptOf(state: ReconnectState) {
  return state.status === "disposed" ? -1 : state.attempt
}

function checking() {
  return transitionReconnect(createReconnectState(false), mutated(true, false)).state
}

describe("reconnect machine", () => {
  test("detects an ancestor removed, then the element reparented in a later batch", () => {
    // `wrap.remove(); staging.append(scroller)`: the removal record no longer contains the element.
    const detached = transitionReconnect(createReconnectState(true), mutated(false, false))
    expect(detached.state.status).toBe("detached")
    expect(detached.effects).toEqual([])

    // `main.append(staging)`
    const back = transitionReconnect(detached.state, mutated(true, true))
    expect(back.state).toMatchObject({ status: "checking", deadline: 100, framesAfterDeadline: 0 })
    expect(back.effects).toEqual([{ type: "reconnected" }, { type: "frame.schedule", attempt: attemptOf(back.state) }])
  })

  test("detects a detach and reattach within one batch", () => {
    // `wrap.remove(); main.append(scroller)`
    const next = transitionReconnect(createReconnectState(true), mutated(true, true))
    expect(next.state.status).toBe("checking")
    expect(next.effects.filter((effect) => effect.type === "reconnected")).toHaveLength(1)
  })

  test("ignores unrelated mutations without a new state", () => {
    const attached = createReconnectState(true)
    expect(transitionReconnect(attached, mutated(true, false)).state).toBe(attached)

    const state = checking()
    expect(transitionReconnect(state, mutated(true, false)).state).toBe(state)

    const detached = createReconnectState(false)
    expect(transitionReconnect(detached, mutated(false, false)).state).toBe(detached)
  })

  test("a detach mid-check cancels the frame", () => {
    const next = transitionReconnect(checking(), mutated(false, false))
    expect(next.state.status).toBe("detached")
    expect(next.effects).toEqual([{ type: "frame.cancel" }])
  })

  test("a second reattach mid-check restarts the window", () => {
    const state = checking()
    const next = transitionReconnect(state, mutated(true, true, 500))
    expect(next.state).toMatchObject({ status: "checking", deadline: 500 })
    expect(next.effects.map((effect) => effect.type)).toEqual(["frame.cancel", "reconnected", "frame.schedule"])
    expect(transitionReconnect(next.state, frame(state, 600)).state).toBe(next.state)
  })

  test("delivers a divergent offset and settles two frames after the deadline", () => {
    const state = checking()
    const first = transitionReconnect(state, frame(state, 50, 0, 79_400))
    expect(first.state).toBe(state)
    expect(first.effects).toEqual([
      { type: "offset.deliver", offset: 0 },
      { type: "frame.schedule", attempt: attemptOf(state) },
    ])

    const second = transitionReconnect(first.state, frame(state, 100))
    expect(second.state).toMatchObject({ status: "checking", framesAfterDeadline: 1 })
    expect(second.effects).toEqual([{ type: "frame.schedule", attempt: attemptOf(state) }])

    const third = transitionReconnect(second.state, frame(state, 116))
    expect(third.state.status).toBe("attached")
    expect(third.effects).toEqual([])
  })

  test("a disconnected frame delivers nothing", () => {
    const state = checking()
    const next = transitionReconnect(state, { ...frame(state, 50, 0, 79_400), connected: false })
    expect(next.effects.map((effect) => effect.type)).toEqual(["frame.schedule"])
  })

  test("disposal cancels a pending frame and deactivates the observer", () => {
    const next = transitionReconnect(checking(), DISPOSED_RECONNECT_EVENT)
    expect(next.effects).toEqual([{ type: "frame.cancel" }])
    expect(isReconnectObserverActive(next.state)).toBe(false)
    expect(transitionReconnect(next.state, mutated(true, true)).state).toBe(next.state)
  })
})

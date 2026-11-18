import { expect, test } from "bun:test"
import {
  selectJumpHistory,
  selectJumpOpening,
  selectJumpStatus,
  startJumpToMessage,
  transitionJumpToMessage,
  type JumpToMessageEvent,
  type JumpToMessageTransition,
} from "./jump-to-message-machine"

const history = [{ id: "msg_1", text: "first", created: 1 }]

function replay(events: JumpToMessageEvent[], from: JumpToMessageTransition = startJumpToMessage()) {
  return events.reduce<JumpToMessageTransition[]>((steps, event) => {
    steps.push(transitionJumpToMessage(steps.at(-1)?.state ?? from.state, event))

    return steps
  }, [])
}

test("the older history loads on open, then selecting an unloaded prompt pages back to it and jumps", () => {
  const start = startJumpToMessage()

  const [loaded, selected, opened] = replay(
    [
      { type: "history.loaded", attempt: 1, history },
      { type: "selected", id: "msg_1", loaded: false },
      { type: "opened", attempt: 2 },
    ],
    start,
  )

  expect(start.effects).toEqual([{ type: "history.load", attempt: 1 }])
  expect(selectJumpHistory(loaded!.state)).toEqual(history)
  expect(selected?.effects).toEqual([{ type: "open.load", attempt: 2, target: "msg_1" }])
  expect(selectJumpOpening(selected!.state)).toBe(true)
  expect(selectJumpStatus(selected!.state)).toBe("opening")
  expect(opened?.state.status).toBe("closed")
  expect(opened?.effects).toEqual([{ type: "jump", id: "msg_1" }])
})

test("a loaded prompt jumps at once and cancels the history still loading", () => {
  const [selected] = replay([{ type: "selected", id: "msg_2", loaded: true }])

  expect(selected?.state.status).toBe("closed")
  expect(selected?.effects).toEqual([{ type: "cancel" }, { type: "jump", id: "msg_2" }])
})

test("an unloaded prompt cannot be selected before the history loads, or while another opens", () => {
  const [early, loaded, first, second] = replay([
    { type: "selected", id: "msg_1", loaded: false },
    { type: "history.loaded", attempt: 1, history },
    { type: "selected", id: "msg_1", loaded: false },
    { type: "selected", id: "msg_1", loaded: true },
  ])

  expect(early?.effects).toEqual([])
  expect(early?.state.status).toBe("loading")
  expect(first?.effects).toHaveLength(1)
  expect(second?.state).toBe(first!.state)
  expect(second?.effects).toEqual([])
  expect(loaded?.state.status).toBe("ready")
})

test("a failed history offers a retry that loads again, and drops the failed attempt's late result", () => {
  const [failed, early, retried, stale, loaded] = replay([
    { type: "history.failed", attempt: 1 },
    { type: "retry" },
    { type: "retry" },
    { type: "history.loaded", attempt: 1, history },
    { type: "history.loaded", attempt: 2, history },
  ])

  expect(selectJumpStatus(failed!.state)).toBe("failed")
  expect(early?.state).toMatchObject({ status: "loading", attempt: 2 })
  expect(early?.effects).toEqual([{ type: "history.load", attempt: 2 }])
  expect(retried?.state).toBe(early!.state)
  expect(retried?.effects).toEqual([])
  expect(stale?.state).toBe(early!.state)
  expect(loaded?.state.status).toBe("ready")
})

test("a failed or timed out open returns to the list, and selecting again tries again", () => {
  const [, , failed, again, opened] = replay([
    { type: "history.loaded", attempt: 1, history },
    { type: "selected", id: "msg_1", loaded: false },
    { type: "open.failed", attempt: 2 },
    { type: "selected", id: "msg_1", loaded: false },
    { type: "opened", attempt: 3 },
  ])

  expect(selectJumpStatus(failed!.state)).toBe("openFailed")
  expect(selectJumpHistory(failed!.state)).toEqual(history)
  expect(again?.effects).toEqual([{ type: "open.load", attempt: 3, target: "msg_1" }])
  expect(opened?.effects).toEqual([{ type: "jump", id: "msg_1" }])
})

test("a result from an earlier attempt is ignored", () => {
  const [, , stale] = replay([
    { type: "history.loaded", attempt: 1, history },
    { type: "selected", id: "msg_1", loaded: false },
    { type: "opened", attempt: 1 },
  ])

  expect(selectJumpOpening(stale!.state)).toBe(true)
  expect(stale?.effects).toEqual([])
})

test("disposing cancels the work, and nothing after it changes or jumps", () => {
  const [, , disposed, opened, again] = replay([
    { type: "history.loaded", attempt: 1, history },
    { type: "selected", id: "msg_1", loaded: false },
    { type: "disposed" },
    { type: "opened", attempt: 2 },
    { type: "disposed" },
  ])

  expect(disposed?.effects).toEqual([{ type: "cancel" }])
  expect(opened?.state).toBe(disposed!.state)
  expect(opened?.effects).toEqual([])
  expect(again?.effects).toEqual([])
})

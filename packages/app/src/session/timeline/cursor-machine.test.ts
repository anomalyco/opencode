import { describe, expect, test } from "bun:test"
import { messageIdFromHash } from "../message-id-from-hash"
import {
  CLEAR_CURSOR_EVENT,
  createTimelineCursorState,
  CURSOR_SEEK_LIMIT,
  cursorMessageID,
  DISPOSED_CURSOR_EVENT,
  freshCursorMessageID,
  hasFreshCursorOrSeek,
  LATEST_ADVANCED_EVENT,
  pendingCursorMessageID,
  SCROLL_MOVED_EVENT,
  SESSION_CHANGED_EVENT,
  transitionTimelineCursor,
  type TimelineCursorEvent,
  type TimelineCursorState,
} from "./cursor-machine"

const jump = (messageID: string): TimelineCursorEvent => ({ type: "message.jump", messageID, behavior: "auto" })

// Built the way the driver builds it from `location.hash`.
const hash = (value: string, initial = false, reveal = false): TimelineCursorEvent => ({
  type: "hash.applied",
  hash: value.slice(1),
  messageID: messageIdFromHash(value.slice(1)),
  initial,
  reveal,
})

function replay(events: TimelineCursorEvent[], from = createTimelineCursorState()) {
  return events.reduce((state, event) => transitionTimelineCursor(state, event).state, from)
}

function expectIgnored(state: TimelineCursorState, event: TimelineCursorEvent) {
  const next = transitionTimelineCursor(state, event)

  expect(next.state).toBe(state)
  expect(next.effects).toEqual([])
}

const landed = (state: TimelineCursorState) => replay([{ type: "seek.landed", attempt: state.attempt }], state)

describe("cursor machine", () => {
  test("jumping back to the same prompt after scrolling away makes it fresh again", () => {
    const scrolled = replay([jump("msg_5"), SCROLL_MOVED_EVENT])
    expect(freshCursorMessageID(scrolled)).toBeUndefined()
    expect(cursorMessageID(scrolled)).toBe("msg_5")

    const again = transitionTimelineCursor(scrolled, jump("msg_5"))
    expect(freshCursorMessageID(again.state)).toBe("msg_5")
    expect(again.effects).toEqual([
      { type: "follow.detach" },
      { type: "hash.set", messageID: "msg_5" },
      { type: "seek.start", attempt: again.state.attempt, messageID: "msg_5", behavior: "auto" },
    ])
  })

  test("a Find or tool reveal makes the cursor stale and cancels its seek", () => {
    const seeking = replay([jump("msg_10")])
    const moved = transitionTimelineCursor(seeking, SCROLL_MOVED_EVENT)

    expect(moved.state).toEqual({ status: "selected", messageID: "msg_10", fresh: false, attempt: seeking.attempt + 1 })
    expect(moved.effects).toEqual([{ type: "seek.cancel" }])
    expectIgnored(moved.state, { type: "seek.missing", attempt: seeking.attempt })
    expectIgnored(moved.state, { type: "seek.landed", attempt: seeking.attempt })
  })

  test("undo or redo while pinned does not leave a cursor behind", () => {
    expectIgnored(createTimelineCursorState(), { type: "message.select", messageID: "msg_2", following: true })

    const selected = replay([{ type: "message.select", messageID: "msg_2", following: false }])
    expect(freshCursorMessageID(selected)).toBe("msg_2")
    expect(replay([{ type: "message.select", messageID: "msg_3", following: true }], selected).status).toBe("none")
  })

  test("clearing its own hash does not scroll again, while Browser Back off a prompt returns to the end", () => {
    const selected = landed(replay([jump("msg_5")]))
    const cleared = transitionTimelineCursor(selected, CLEAR_CURSOR_EVENT)

    expect(cleared.state.status).toBe("none")
    expect(cleared.effects).toEqual([{ type: "hash.clear" }])
    // The router echoes the cleared hash; a smooth return to the end must keep its course.
    expectIgnored(cleared.state, hash(""))

    const back = transitionTimelineCursor(selected, hash(""))
    expect(back.state.status).toBe("none")
    expect(back.effects).toEqual([{ type: "follow.end" }])
  })

  test("the router's echo of the cursor's own hash does not seek again", () => {
    const seeking = replay([jump("msg_5")])

    expectIgnored(seeking, hash("#message-msg_5"))
    expectIgnored(replay([SCROLL_MOVED_EVENT], seeking), hash("#message-msg_5"))
  })

  test("a hash target waits until its prompt loads, then seeks to it", () => {
    const pending = transitionTimelineCursor(createTimelineCursorState(), hash("#message-msg_1", true))

    expect(pendingCursorMessageID(pending.state)).toBe("msg_1")
    expect(pending.effects).toEqual([{ type: "follow.detach" }])
    expectIgnored(pending.state, { type: "target.loaded", messageID: "msg_2" })

    const loaded = transitionTimelineCursor(pending.state, { type: "target.loaded", messageID: "msg_1" })
    expect(freshCursorMessageID(loaded.state)).toBe("msg_1")
    expect(loaded.effects).toEqual([
      { type: "follow.detach" },
      { type: "hash.set", messageID: "msg_1" },
      { type: "seek.schedule", attempt: loaded.state.attempt, messageID: "msg_1", behavior: "auto" },
    ])
  })

  test("a session switch drops the previous session's target and seek", () => {
    const pending = replay([hash("#message-msg_a", true)])
    expect(replay([SESSION_CHANGED_EVENT], pending)).toEqual({ status: "none", attempt: pending.attempt + 1 })

    const seeking = replay([jump("msg_a")])
    const switched = transitionTimelineCursor(seeking, SESSION_CHANGED_EVENT)
    expect(switched.effects).toEqual([{ type: "seek.cancel" }])
    expectIgnored(switched.state, { type: "seek.missing", attempt: seeking.attempt })
  })

  test("a seek retries for a bounded number of frames", () => {
    const seeking = replay([jump("msg_5")])
    const missing: TimelineCursorEvent = { type: "seek.missing", attempt: seeking.attempt }

    const retried = Array.from({ length: CURSOR_SEEK_LIMIT }).reduce<TimelineCursorState>((state) => {
      const next = transitionTimelineCursor(state, missing)
      expect(next.effects).toEqual([
        { type: "seek.schedule", attempt: seeking.attempt, messageID: "msg_5", behavior: "auto" },
      ])

      return next.state
    }, seeking)

    const settled = transitionTimelineCursor(retried, missing)
    expect(settled.state).toEqual({ status: "selected", messageID: "msg_5", fresh: true, attempt: seeking.attempt })
    expect(settled.effects).toEqual([])
    expect(hasFreshCursorOrSeek(settled.state)).toBe(true)
    expect(landed(seeking)).toEqual(settled.state)
  })

  test("the first apply of an empty hash goes to the end unless the route reveals a tool", () => {
    expect(transitionTimelineCursor(createTimelineCursorState(), hash("", true)).effects).toEqual([
      { type: "follow.end" },
    ])
    expectIgnored(createTimelineCursorState(), hash("", true, true))
    expect(transitionTimelineCursor(createTimelineCursorState(), hash("#section")).effects).toEqual([
      { type: "anchor.scroll", id: "section" },
    ])
  })

  test("a newer prompt clears the selection but keeps a pending target", () => {
    expect(replay([jump("msg_1"), LATEST_ADVANCED_EVENT]).status).toBe("none")
    expectIgnored(replay([hash("#message-msg_1")]), LATEST_ADVANCED_EVENT)
  })

  test("steady scrolling and disposal of an idle cursor keep the same state", () => {
    const stale = replay([jump("msg_1"), SCROLL_MOVED_EVENT])

    expectIgnored(createTimelineCursorState(), SCROLL_MOVED_EVENT)
    expectIgnored(stale, SCROLL_MOVED_EVENT)
    expectIgnored(createTimelineCursorState(), DISPOSED_CURSOR_EVENT)
    expect(transitionTimelineCursor(replay([jump("msg_1")]), DISPOSED_CURSOR_EVENT).effects).toEqual([
      { type: "seek.cancel" },
    ])
  })
})

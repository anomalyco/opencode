import { describe, expect, test } from "bun:test"
import {
  CLEAR_WITHOUT_HASH_EVENT,
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
  VIEW_READY_EVENT,
  VIEW_UNREADY_EVENT,
  type TimelineCursorEvent,
  type TimelineCursorState,
} from "./cursor-machine"

// Events are built the way the driver builds them from `location.hash`, without its `#`.
const changed = (hash: string, viewReady = true): TimelineCursorEvent => ({
  type: "hash.changed",
  hash: hash.slice(1),
  viewReady,
})

const applied = (state: TimelineCursorState, hash: string, reveal = false): TimelineCursorEvent => ({
  type: "hash.applied",
  attempt: state.attempt,
  hash: hash.slice(1),
  reveal,
})

const jump = (messageID: string, hash = "", viewReady = true): TimelineCursorEvent => ({
  type: "message.jump",
  messageID,
  behavior: "auto",
  hash: hash.slice(1),
  viewReady,
})

const clear = (hash: string): TimelineCursorEvent =>
  hash ? { type: "clear", hash: hash.slice(1) } : CLEAR_WITHOUT_HASH_EVENT

type TargetSynced = Extract<TimelineCursorEvent, { type: "target.synced" }>

const synced = (
  state: TimelineCursorState,
  input: Partial<Omit<TargetSynced, "type" | "messageID">> = {},
): TargetSynced => {
  const messageID = pendingCursorMessageID(state)!

  return {
    type: "target.synced",
    messageID,
    loaded: false,
    viewReady: true,
    syncing: false,
    revertMessageID: undefined,
    oldestMessageID: "msg_0040",
    history: "seekable",
    hash: `message-${messageID}`,
    ...input,
  }
}

function replay(events: TimelineCursorEvent[], from = createTimelineCursorState()) {
  return events.reduce((state, event) => transitionTimelineCursor(state, event).state, from)
}

function expectIgnored(state: TimelineCursorState, event: TimelineCursorEvent) {
  const next = transitionTimelineCursor(state, event)

  expect(next.state).toBe(state)
  expect(next.effects).toEqual([])
}

// The session opened on `hash` once its timeline is on screen.
const open = (hash: string, reveal = false) => {
  const scheduled = replay([VIEW_READY_EVENT])

  return transitionTimelineCursor(scheduled, applied(scheduled, hash, reveal))
}

// The route hash changed after the session opened.
const navigate = (state: TimelineCursorState, hash: string) => {
  const scheduled = replay([changed(hash)], state)

  return transitionTimelineCursor(scheduled, applied(scheduled, hash))
}

const idle = () => open("").state

const landed = (state: TimelineCursorState) => replay([{ type: "seek.landed", attempt: state.attempt }], state)

describe("cursor machine", () => {
  test("a hash target the revert hides stops at once and returns an opened session to the end", () => {
    const pending = open("#message-msg_0050").state
    const hidden = transitionTimelineCursor(pending, synced(pending, { revertMessageID: "msg_0048" }))

    expect(hidden.state).toEqual({ status: "none", attempt: pending.attempt + 1, echo: true })
    expect(hidden.effects).toEqual([{ type: "follow.end" }, { type: "hash.clear" }])
    // The router's repeat of the cleared hash is consumed without scrolling again.
    const echoed = transitionTimelineCursor(hidden.state, changed(""))
    expect(echoed.state).toEqual({ status: "none", attempt: hidden.state.attempt })
    expect(echoed.effects).toEqual([])
  })

  test("a hash target at or after the oldest loaded message stops once the transcript has synced", () => {
    const pending = open("#message-msg_0045").state

    expectIgnored(pending, synced(pending, { syncing: true }))
    expect(transitionTimelineCursor(pending, synced(pending)).effects).toEqual([
      { type: "follow.end" },
      { type: "hash.clear" },
    ])

    // A later link keeps the reader where they were.
    const linked = navigate(idle(), "#message-zzz").state
    expect(transitionTimelineCursor(linked, synced(linked)).effects).toEqual([{ type: "hash.clear" }])
  })

  test("a hash target older than the loaded messages pages until it loads, history runs out or a page fails", () => {
    const pending = open("#message-msg_0010").state
    const seek = transitionTimelineCursor(pending, synced(pending))

    expect(seek.state).toBe(pending)
    expect(seek.effects).toEqual([{ type: "history.seek" }])
    expectIgnored(pending, synced(pending, { history: "loading" }))

    // An older page that passes the target without it ends the search.
    expect(transitionTimelineCursor(pending, synced(pending, { oldestMessageID: "msg_0005" })).state.status).toBe(
      "none",
    )

    const exhausted = transitionTimelineCursor(pending, synced(pending, { history: "exhausted" }))
    expect(exhausted.state.status).toBe("none")
    expect(exhausted.effects).toEqual([{ type: "follow.end" }, { type: "hash.clear" }])

    // A failed page keeps the hash for a reload.
    const failed = transitionTimelineCursor(pending, synced(pending, { history: "failed" }))
    expect(failed.state).toEqual({ status: "none", attempt: pending.attempt + 1 })
    expect(failed.effects).toEqual([{ type: "follow.end" }])

    // A hash that no longer names the target is left alone.
    expect(transitionTimelineCursor(pending, synced(pending, { history: "exhausted", hash: "" })).effects).toEqual([
      { type: "follow.end" },
    ])
  })

  test("jumping back onto the prompt the hash already names writes nothing, so a later link still navigates", () => {
    const first = transitionTimelineCursor(idle(), jump("msg_5"))
    expect(first.effects).toContainEqual({ type: "hash.set", messageID: "msg_5" })
    const scrolled = replay([changed("#message-msg_5"), SCROLL_MOVED_EVENT], first.state)
    expect(freshCursorMessageID(scrolled)).toBeUndefined()
    expect(cursorMessageID(scrolled)).toBe("msg_5")

    const again = transitionTimelineCursor(scrolled, jump("msg_5", "#message-msg_5"))
    expect(freshCursorMessageID(again.state)).toBe("msg_5")
    expect(again.state).toMatchObject({ echo: false })
    expect(again.effects).toEqual([
      { type: "follow.detach" },
      { type: "seek.start", attempt: again.state.attempt, messageID: "msg_5", behavior: "auto" },
    ])

    const linked = navigate(replay([SCROLL_MOVED_EVENT], again.state), "#message-msg_5")
    expect(pendingCursorMessageID(linked.state)).toBe("msg_5")
  })

  test("a hash waits for the timeline to be on screen, and a hidden timeline drops the frame", () => {
    const hidden = replay([changed("#message-msg_5", false)])
    expect(hidden).toEqual(createTimelineCursorState())

    const shown = transitionTimelineCursor(hidden, VIEW_READY_EVENT)
    expect(shown.state).toEqual({ status: "applying", initial: true, scheduled: true, attempt: 1 })
    expect(shown.effects).toEqual([{ type: "apply.schedule", attempt: 1 }])

    const away = transitionTimelineCursor(shown.state, VIEW_UNREADY_EVENT)
    expect(away.state).toEqual({ status: "applying", initial: true, scheduled: false, attempt: 2 })
    expect(away.effects).toEqual([{ type: "apply.cancel" }])
    expectIgnored(away.state, applied(shown.state, "#message-msg_5"))
  })

  test("a loaded target seeks only once the timeline is on screen", () => {
    const pending = open("#message-msg_5").state

    expectIgnored(pending, synced(pending, { loaded: true, viewReady: false }))
    const loaded = transitionTimelineCursor(pending, synced(pending, { loaded: true }))
    expect(loaded.state).toEqual({
      status: "selected",
      messageID: "msg_5",
      fresh: true,
      attempt: pending.attempt + 1,
      seek: { behavior: "auto", retries: 0 },
    })
    expect(loaded.effects).toEqual([
      { type: "follow.detach" },
      { type: "seek.schedule", attempt: loaded.state.attempt, messageID: "msg_5", behavior: "auto" },
    ])
  })

  test("hiding the timeline pauses a seek, and showing it again starts the seek over", () => {
    const seeking = replay([jump("msg_5")], idle())

    const exhausted = Array.from({ length: CURSOR_SEEK_LIMIT }).reduce<TimelineCursorState>(
      (state) => replay([{ type: "seek.missing", attempt: seeking.attempt }], state),
      seeking,
    )

    const paused = transitionTimelineCursor(exhausted, VIEW_UNREADY_EVENT)
    expect(paused.state).toMatchObject({ attempt: seeking.attempt + 1, seek: { retries: 0, paused: true } })
    expect(paused.effects).toEqual([{ type: "seek.cancel" }])
    expectIgnored(paused.state, { type: "seek.missing", attempt: paused.state.attempt })
    expectIgnored(paused.state, VIEW_UNREADY_EVENT)

    const resumed = transitionTimelineCursor(paused.state, VIEW_READY_EVENT)
    expect(resumed.state).toMatchObject({ attempt: paused.state.attempt + 1, seek: { behavior: "auto", retries: 0 } })
    expect(resumed.effects).toEqual([
      { type: "seek.schedule", attempt: resumed.state.attempt, messageID: "msg_5", behavior: "auto" },
    ])

    // A jump while the timeline is hidden waits the same way.
    const hiddenJump = transitionTimelineCursor(replay([VIEW_UNREADY_EVENT], idle()), jump("msg_3", "", false))
    expect(hiddenJump.effects).toEqual([{ type: "follow.detach" }, { type: "hash.set", messageID: "msg_3" }])
    expect(hasFreshCursorOrSeek(hiddenJump.state)).toBe(true)
  })

  test("a session switch, clear or jump drops the apply frame already scheduled", () => {
    const scheduled = replay([VIEW_READY_EVENT])
    const late = applied(scheduled, "#message-msg_a")

    const switched = transitionTimelineCursor(scheduled, SESSION_CHANGED_EVENT)
    expect(switched.state).toEqual({ status: "applying", initial: true, scheduled: false, attempt: 2 })
    expect(switched.effects).toEqual([{ type: "apply.cancel" }])
    expectIgnored(switched.state, late)

    const cleared = transitionTimelineCursor(scheduled, clear("#message-msg_a"))
    expect(cleared.effects).toEqual([{ type: "apply.cancel" }, { type: "hash.clear" }])
    expectIgnored(cleared.state, late)

    const jumped = transitionTimelineCursor(scheduled, jump("msg_b", "#message-msg_a"))
    expect(jumped.effects[0]).toEqual({ type: "apply.cancel" })
    expectIgnored(jumped.state, late)
  })

  test("Browser Back off an anchor returns to the end, while the cursor's own clear does not scroll again", () => {
    const anchored = navigate(idle(), "#section")
    expect(anchored.effects).toEqual([{ type: "anchor.scroll", id: "section" }])

    const back = navigate(anchored.state, "")
    expect(back.state).toMatchObject({ status: "none" })
    expect(back.effects).toEqual([{ type: "follow.end" }])

    const selected = landed(replay([jump("msg_5"), changed("#message-msg_5")], idle()))
    const cleared = transitionTimelineCursor(selected, clear("#message-msg_5"))
    expect(cleared.state).toEqual({ status: "none", attempt: selected.attempt + 1, echo: true })
    expect(cleared.effects).toEqual([{ type: "hash.clear" }])
    expect(transitionTimelineCursor(cleared.state, changed("")).effects).toEqual([])

    // Back off a prompt returns to the end too.
    expect(navigate(selected, "").effects).toEqual([{ type: "follow.end" }])
  })

  test("a Find or tool reveal makes the cursor stale and cancels its seek", () => {
    const seeking = replay([jump("msg_10")], idle())
    const moved = transitionTimelineCursor(seeking, SCROLL_MOVED_EVENT)

    expect(moved.state).toEqual({
      status: "selected",
      messageID: "msg_10",
      fresh: false,
      attempt: seeking.attempt + 1,
      echo: true,
    })
    expect(moved.effects).toEqual([{ type: "seek.cancel" }])
    expectIgnored(moved.state, { type: "seek.missing", attempt: seeking.attempt })
    expectIgnored(moved.state, { type: "seek.landed", attempt: seeking.attempt })
  })

  test("undo or redo while pinned does not leave a cursor behind", () => {
    expectIgnored(idle(), { type: "message.select", messageID: "msg_2", following: true })
    expectIgnored(createTimelineCursorState(), { type: "message.select", messageID: undefined, following: false })

    const selected = replay([{ type: "message.select", messageID: "msg_2", following: false }], idle())
    expect(freshCursorMessageID(selected)).toBe("msg_2")
    expect(replay([{ type: "message.select", messageID: "msg_3", following: true }], selected).status).toBe("none")
  })

  test("the router's echo of the cursor's own hash does not seek again, once", () => {
    const seeking = replay([jump("msg_5")], idle())

    for (const state of [seeking, replay([SCROLL_MOVED_EVENT], seeking)]) {
      const echoed = transitionTimelineCursor(state, changed("#message-msg_5"))

      expect(echoed.state).toMatchObject({ status: "selected", messageID: "msg_5", echo: false })
      expect(echoed.state.attempt).toBe(state.attempt)
      expect(echoed.effects).toEqual([])
      // Only the write echoes; the same hash applied again is a real navigation.
      expect(navigate(echoed.state, "#message-msg_5").state.status).toBe("pending")
    }
  })

  test("a link to the prompt undo, redo or rewind selected still navigates to it", () => {
    const undone = replay([{ type: "message.select", messageID: "msg_3", following: false }], idle())
    const linked = navigate(undone, "#message-msg_3")

    expect(pendingCursorMessageID(linked.state)).toBe("msg_3")
    expect(linked.effects).toEqual([{ type: "follow.detach" }])
    expectIgnored(linked.state, changed("#message-msg_3"))
  })

  test("a hash target ignores reconciliation for another target", () => {
    const pending = open("#message-msg_1").state

    expect(pendingCursorMessageID(pending)).toBe("msg_1")
    expectIgnored(pending, { ...synced(pending, { loaded: true }), messageID: "msg_2" })
    expectIgnored(idle(), synced(pending, { loaded: true }))
  })

  test("a session switch drops the previous session's target and seek", () => {
    const pending = open("#message-msg_a").state
    expect(replay([SESSION_CHANGED_EVENT], pending)).toEqual({
      status: "applying",
      initial: true,
      scheduled: false,
      attempt: pending.attempt + 1,
    })
    expectIgnored(createTimelineCursorState(), SESSION_CHANGED_EVENT)

    const seeking = replay([jump("msg_a")], idle())
    const switched = transitionTimelineCursor(seeking, SESSION_CHANGED_EVENT)
    expect(switched.effects).toEqual([{ type: "seek.cancel" }])
    expectIgnored(switched.state, { type: "seek.missing", attempt: seeking.attempt })
  })

  test("a hash change while switching sessions stays an initial apply", () => {
    const scheduled = replay([changed("#message-msg_a")], replay([VIEW_READY_EVENT]))

    expect(scheduled).toMatchObject({ status: "applying", initial: true, scheduled: true })
    expect(transitionTimelineCursor(scheduled, applied(scheduled, "#message-msg_a")).state).toMatchObject({
      status: "pending",
      endOnMiss: true,
    })
  })

  test("a seek retries for a bounded number of frames", () => {
    const seeking = replay([jump("msg_5")], idle())
    const missing: TimelineCursorEvent = { type: "seek.missing", attempt: seeking.attempt }

    const retried = Array.from({ length: CURSOR_SEEK_LIMIT }).reduce<TimelineCursorState>((state) => {
      const next = transitionTimelineCursor(state, missing)
      expect(next.effects).toEqual([
        { type: "seek.schedule", attempt: seeking.attempt, messageID: "msg_5", behavior: "auto" },
      ])

      return next.state
    }, seeking)

    const settled = transitionTimelineCursor(retried, missing)
    expect(settled.state).toEqual({
      status: "selected",
      messageID: "msg_5",
      fresh: true,
      attempt: seeking.attempt,
      echo: true,
    })
    expect(settled.effects).toEqual([])
    expect(hasFreshCursorOrSeek(settled.state)).toBe(true)
    expect(landed(seeking)).toEqual(settled.state)
  })

  test("the first apply of an empty hash goes to the end unless the route reveals a tool", () => {
    expect(open("").effects).toEqual([{ type: "follow.end" }])
    expect(open("", true).effects).toEqual([])
    expect(open("#message-msg_1", true).state).toMatchObject({ status: "pending", endOnMiss: false })
  })

  test("a newer prompt clears the selection but keeps a pending target", () => {
    expect(replay([jump("msg_1"), LATEST_ADVANCED_EVENT], idle()).status).toBe("none")
    expectIgnored(open("#message-msg_1").state, LATEST_ADVANCED_EVENT)
  })

  test("steady scrolling and disposal of an idle cursor keep the same state", () => {
    const stale = replay([jump("msg_1"), SCROLL_MOVED_EVENT], idle())

    expectIgnored(idle(), SCROLL_MOVED_EVENT)
    expectIgnored(stale, SCROLL_MOVED_EVENT)
    expectIgnored(idle(), DISPOSED_CURSOR_EVENT)
    expectIgnored(idle(), CLEAR_WITHOUT_HASH_EVENT)
    expect(transitionTimelineCursor(replay([jump("msg_1")], idle()), DISPOSED_CURSOR_EVENT).effects).toEqual([
      { type: "seek.cancel" },
    ])
    expect(transitionTimelineCursor(replay([VIEW_READY_EVENT]), DISPOSED_CURSOR_EVENT).effects).toEqual([
      { type: "apply.cancel" },
    ])
  })
})

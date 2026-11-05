import { describe, expect, test } from "bun:test"
import {
  FILE_SCROLL_INTERACTED,
  FILE_SCROLL_RESTORE_REQUESTED,
  FILE_SCROLL_REVEAL_REQUESTED,
  canRestoreFileScroll,
  canSaveFileScroll,
  createFileScrollState,
  transitionFileScroll,
  type FileScrollContext,
  type FileScrollEffect,
  type FileScrollEvent,
  type FileScrollState,
} from "./scroll-machine"

const shown: FileScrollContext = {
  sessionKey: "alpha",
  scrollKey: "file:a.ts",
  scroller: true,
  loaded: true,
  fileReady: true,
  layoutReady: true,
  shown: true,
}

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: FileScrollState, ...events: FileScrollEvent[]) {
  return events.reduce<{ state: FileScrollState; effects: readonly FileScrollEffect[] }>(
    (result, event) => {
      const next = transitionFileScroll(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

function synced(context: FileScrollContext): FileScrollEvent {
  return { type: "context.synced", context }
}

function scrolled(y: number): FileScrollEvent {
  return { type: "scrolled", position: { x: 0, y } }
}

function write(y: number, context = shown): FileScrollEffect {
  return { type: "save.write", sessionKey: context.sessionKey, scrollKey: context.scrollKey, position: { x: 0, y } }
}

// The user scrolled to 420; its save frame (attempt 3) has not run yet.
const unsaved = () => play(createFileScrollState(), synced(shown), FILE_SCROLL_INTERACTED, scrolled(420)).state

describe("restoring", () => {
  test("user input in the frame a restore was queued for cancels it and keeps the user's scroll", () => {
    const queued = play(createFileScrollState(), synced(shown))

    expect(queued.effects).toEqual([{ type: "frame.restore", attempt: 1 }])

    const user = play(queued.state, FILE_SCROLL_INTERACTED, scrolled(420))

    // The restore frame checks this before it moves the view.
    expect(canRestoreFileScroll(user.state, 1)).toBe(false)

    const saved = play(user.state, { type: "restore.stepped", attempt: 1 }, { type: "save.stepped", attempt: 3 })

    expect([...user.effects, ...saved.effects]).toEqual([
      { type: "frame.cancel" },
      { type: "frame.save", attempt: 3 },
      write(420),
    ])
    expect(saved.state).toMatchObject({ status: "settled", pending: undefined })
  })

  test("a render or a late view state load after the user scrolled never restores over the user's scroll", () => {
    const state = unsaved()
    const rendered = transitionFileScroll(state, FILE_SCROLL_RESTORE_REQUESTED)

    expect(rendered.state).toBe(state)
    expect(rendered.effects).toEqual([])

    const reloaded = play(state, synced({ ...shown, fileReady: false }), synced(shown))

    expect(reloaded.effects).toEqual([])
    expect(reloaded.state).toMatchObject({ status: "settled", pending: { x: 0, y: 420 } })
  })

  test("a scroll a restore clamps short is not stored, and the next render restores the rest", () => {
    const restored = play(createFileScrollState(), synced(shown), { type: "restore.stepped", attempt: 1 })

    expect(canSaveFileScroll(restored.state)).toBe(false)

    const clamped = transitionFileScroll(restored.state, scrolled(100))

    expect(clamped.state).toBe(restored.state)
    expect(clamped.effects).toEqual([])

    expect(transitionFileScroll(clamped.state, FILE_SCROLL_RESTORE_REQUESTED).effects).toEqual([
      { type: "frame.restore", attempt: 2 },
    ])
  })

  test("waits for the desktop layout to load before restoring", () => {
    const waiting = play(createFileScrollState(), synced({ ...shown, layoutReady: false }), FILE_SCROLL_RESTORE_REQUESTED)

    expect(waiting.effects).toEqual([])

    expect(transitionFileScroll(waiting.state, synced(shown)).effects).toEqual([{ type: "frame.restore", attempt: 1 }])
  })

  test("restores again when the file's view state loads", () => {
    const restored = play(
      createFileScrollState(),
      synced({ ...shown, fileReady: false }),
      { type: "restore.stepped", attempt: 1 },
      synced(shown),
    )

    expect(restored.effects).toEqual([{ type: "frame.restore", attempt: 1 }, { type: "frame.restore", attempt: 2 }])
  })

  test("several renders in one frame queue one restore", () => {
    const state = play(createFileScrollState(), synced(shown), FILE_SCROLL_RESTORE_REQUESTED, FILE_SCROLL_RESTORE_REQUESTED)

    expect(state.effects).toEqual([{ type: "frame.restore", attempt: 1 }])
  })

  test("input ignores a hidden or unmounted view", () => {
    const hidden = play(createFileScrollState(), synced({ ...shown, shown: false })).state

    expect(transitionFileScroll(hidden, FILE_SCROLL_INTERACTED).state).toBe(hidden)

    const unmounted = play(createFileScrollState(), synced({ ...shown, scroller: false })).state

    expect(transitionFileScroll(unmounted, FILE_SCROLL_INTERACTED).state).toBe(unmounted)
  })
})

describe("saving", () => {
  test("stores the user's last offset once per frame", () => {
    const state = play(unsaved(), scrolled(430), scrolled(440), { type: "save.stepped", attempt: 3 })

    expect(state.effects).toEqual([write(440)])
  })

  test("further input while settled changes nothing", () => {
    const state = unsaved()

    expect(transitionFileScroll(state, FILE_SCROLL_INTERACTED).state).toBe(state)
    expect(transitionFileScroll(state, scrolled(420)).state).toBe(state)
  })

  test("ignores a stale save frame", () => {
    const state = unsaved()

    expect(transitionFileScroll(state, { type: "save.stepped", attempt: 2 }).state).toBe(state)
  })

  test("an unmount stores the offset its save frame was waiting to store", () => {
    const disposed = transitionFileScroll(unsaved(), { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "frame.cancel" }, write(420)])
    expect(disposed.state.status).toBe("disposed")
  })

  test("hiding the tab stores the unsaved offset, and showing it again restores", () => {
    const hidden = play(unsaved(), synced({ ...shown, shown: false }))

    expect(hidden.effects).toEqual([{ type: "frame.cancel" }, write(420)])

    expect(transitionFileScroll(hidden.state, synced(shown)).effects).toEqual([{ type: "frame.restore", attempt: 5 }])
  })

  test("a session switch stores the unsaved offset under the previous session and restores the next one", () => {
    const next = { ...shown, sessionKey: "beta" }
    const switched = play(unsaved(), synced(next))

    expect(switched.effects).toEqual([{ type: "frame.cancel" }, write(420), { type: "frame.restore", attempt: 4 }])
  })

  test("a remounted code view restores again", () => {
    const remounted = play(unsaved(), { type: "save.stepped", attempt: 3 }, synced({ ...shown, scroller: false }), synced(shown))

    expect(remounted.effects).toEqual([write(420), { type: "frame.restore", attempt: 5 }])
  })
})

describe("revealing", () => {
  test("a revealed line range drops the unsaved offset so it cannot overwrite the reveal", () => {
    const revealed = transitionFileScroll(unsaved(), FILE_SCROLL_REVEAL_REQUESTED)

    expect(revealed.effects).toEqual([{ type: "frame.cancel" }, { type: "frame.restore", attempt: 4 }])
    expect(revealed.state).toMatchObject({ status: "restoring", restoreQueued: true })
  })

  test("a hidden view reveals once it shows", () => {
    const hidden = play(createFileScrollState(), synced({ ...shown, shown: false }), FILE_SCROLL_REVEAL_REQUESTED)

    expect(hidden.effects).toEqual([])

    expect(transitionFileScroll(hidden.state, synced(shown)).effects).toEqual([{ type: "frame.restore", attempt: 2 }])
  })
})

describe("disposed", () => {
  test("ignores every later event", () => {
    const disposed = play(createFileScrollState(), synced(shown), { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "frame.restore", attempt: 1 }, { type: "frame.cancel" }])

    const late = play(
      disposed.state,
      { type: "restore.stepped", attempt: 1 },
      synced({ ...shown, sessionKey: "beta" }),
      FILE_SCROLL_INTERACTED,
      scrolled(10),
      FILE_SCROLL_REVEAL_REQUESTED,
    )

    expect(late.state).toBe(disposed.state)
    expect(late.effects).toEqual([])
  })
})

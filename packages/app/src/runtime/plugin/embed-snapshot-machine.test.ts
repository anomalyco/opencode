import { describe, expect, test } from "bun:test"
import {
  DISPOSED_SNAPSHOT_STATE,
  INITIAL_SNAPSHOT_STATE,
  SNAPSHOT_CAPTURE_TIMEOUT_MS,
  SNAPSHOT_PAINT_TIMEOUT_MS,
  SNAPSHOT_THAW_DELAY_MS,
  selectPaintingUrl,
  selectSnapshotHidesNative,
  selectSnapshotNeedsSync,
  selectSnapshotUrl,
  transitionEmbedSnapshot,
  type EmbedSnapshotEffect,
  type EmbedSnapshotEvent,
  type EmbedSnapshotState,
} from "./embed-snapshot-machine"

const sync = (
  covered: boolean,
  input: { id?: string | undefined; visible?: boolean; shown?: boolean } = {},
): EmbedSnapshotEvent => ({
  type: "sync",
  id: "id" in input ? input.id : "embed-Alpha",
  visible: input.visible ?? true,
  shown: input.shown ?? true,
  covered,
})

const settled = (attempt: number, url: string | undefined): EmbedSnapshotEvent => ({
  type: "capture.settled",
  attempt,
  url,
})

function replay(events: EmbedSnapshotEvent[], state: EmbedSnapshotState = INITIAL_SNAPSHOT_STATE) {
  return events.reduce<{ state: EmbedSnapshotState; effects: EmbedSnapshotEffect[] }>(
    (current, event) => {
      const next = transitionEmbedSnapshot(current.state, event)

      return { state: next.state, effects: [...current.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

const capturing = replay([sync(true)]).state

const painting = replay([sync(true), settled(1, "blob:a")]).state

const frozen = replay([sync(true), settled(1, "blob:a"), { type: "snapshot.painted", url: "blob:a" }]).state

const thawing = replay([sync(false)], frozen).state

describe("bug replays", () => {
  test("a capture from before the cover reopened never replaces the fresh one", () => {
    const covered = replay([sync(true), sync(false), sync(true)])
    expect(covered.state).toEqual({ status: "capturing", issued: 2, attempt: 2, id: "embed-Alpha" })

    const stale = transitionEmbedSnapshot(covered.state, settled(1, "blob:stale"))
    expect(stale.state).toBe(covered.state)
    expect(stale.effects).toEqual([{ type: "url.revoke", url: "blob:stale" }])

    const fresh = transitionEmbedSnapshot(stale.state, settled(2, "blob:fresh"))
    expect(selectSnapshotUrl(fresh.state, "embed-Alpha", true)).toBe("blob:fresh")
    expect(selectPaintingUrl(fresh.state)).toBe("blob:fresh")
  })

  test("a still Element Timing never reports still hides the native view once the paint times out", () => {
    expect(selectSnapshotHidesNative(painting, "embed-Alpha", true)).toBe(false)

    const next = transitionEmbedSnapshot(painting, { type: "paint.timeout", attempt: 1 })
    expect(next.state).toEqual({ status: "frozen", issued: 1, id: "embed-Alpha", url: "blob:a" })
    expect(next.effects).toEqual([{ type: "layout.schedule" }])
    expect(selectSnapshotHidesNative(next.state, "embed-Alpha", true)).toBe(true)
  })

  test("a failed or corrupt capture hides the native view without a still and thaws at once", () => {
    const failed = transitionEmbedSnapshot(capturing, settled(1, undefined))
    expect(failed.state).toEqual({ status: "frozen", issued: 1, id: "embed-Alpha", url: undefined })
    expect(failed.effects).toEqual([{ type: "capture-timer.stop" }, { type: "layout.schedule" }])
    expect(selectSnapshotUrl(failed.state, "embed-Alpha", true)).toBeUndefined()
    expect(selectSnapshotHidesNative(failed.state, "embed-Alpha", true)).toBe(true)

    const uncovered = transitionEmbedSnapshot(failed.state, sync(false))
    expect(uncovered.state).toEqual({ status: "live", issued: 1 })
    expect(uncovered.effects).toEqual([])
  })

  test("another embed taking a covered box gives up the previous still in the same step", () => {
    for (const state of [frozen, thawing]) {
      const next = transitionEmbedSnapshot(state, sync(true, { id: "embed-Beta" }))
      const attempt = state.status === "disposed" ? 0 : state.issued + 1
      expect(next.state).toEqual({ status: "capturing", issued: attempt, attempt, id: "embed-Beta" })
      expect(next.effects).toContainEqual({ type: "url.revoke", url: "blob:a" })
      expect(next.effects).toContainEqual({ type: "capture", attempt, id: "embed-Beta" })
      expect(selectSnapshotUrl(next.state, "embed-Alpha", true)).toBeUndefined()
    }

    const uncovered = transitionEmbedSnapshot(frozen, sync(false, { id: "embed-Beta" }))
    expect(uncovered.state).toEqual({ status: "live", issued: 1 })
    expect(uncovered.effects).toEqual([{ type: "url.revoke", url: "blob:a" }])
  })
})

describe("lifecycle", () => {
  test("covering a shown embed captures, paints, freezes, then thaws after the view repaints", () => {
    const covered = transitionEmbedSnapshot(INITIAL_SNAPSHOT_STATE, sync(true))
    expect(covered.effects).toEqual([
      { type: "capture", attempt: 1, id: "embed-Alpha" },
      { type: "capture-timer.start", attempt: 1, delayMs: SNAPSHOT_CAPTURE_TIMEOUT_MS },
    ])

    const decoded = transitionEmbedSnapshot(covered.state, settled(1, "blob:a"))
    expect(decoded.effects).toEqual([
      { type: "capture-timer.stop" },
      { type: "paint-timer.start", attempt: 1, delayMs: SNAPSHOT_PAINT_TIMEOUT_MS },
    ])

    const presented = transitionEmbedSnapshot(decoded.state, { type: "snapshot.painted", url: "blob:a" })
    expect(presented.state).toEqual(frozen)
    expect(presented.effects).toEqual([{ type: "paint-timer.stop" }, { type: "layout.schedule" }])

    const uncovered = transitionEmbedSnapshot(presented.state, sync(false))
    expect(uncovered.state).toEqual({ status: "thawing", issued: 2, attempt: 2, id: "embed-Alpha", url: "blob:a" })
    expect(uncovered.effects).toEqual([{ type: "thaw-timer.start", attempt: 2, delayMs: SNAPSHOT_THAW_DELAY_MS }])
    expect(selectSnapshotHidesNative(uncovered.state, "embed-Alpha", false)).toBe(false)
    expect(selectSnapshotUrl(uncovered.state, "embed-Alpha", true)).toBe("blob:a")

    const released = transitionEmbedSnapshot(uncovered.state, { type: "thaw.settled", attempt: 2 })
    expect(released.state).toEqual({ status: "live", issued: 2 })
    expect(released.effects).toEqual([{ type: "url.revoke", url: "blob:a" }])
  })

  test("covering again while thawing keeps the still and ignores the old thaw", () => {
    const covered = transitionEmbedSnapshot(thawing, sync(true))
    expect(covered.state).toEqual({ status: "frozen", issued: 2, id: "embed-Alpha", url: "blob:a" })
    expect(covered.effects).toEqual([{ type: "thaw-timer.stop" }])
    expect(transitionEmbedSnapshot(covered.state, { type: "thaw.settled", attempt: 2 }).state).toBe(covered.state)
  })

  test("a capture that hangs hides the native view, and its late still is given up", () => {
    const timedOut = transitionEmbedSnapshot(capturing, { type: "capture.timeout", attempt: 1 })
    expect(timedOut.state).toEqual({ status: "frozen", issued: 1, id: "embed-Alpha", url: undefined })
    expect(timedOut.effects).toEqual([{ type: "layout.schedule" }])

    const late = transitionEmbedSnapshot(timedOut.state, settled(1, "blob:late"))
    expect(late.state).toBe(timedOut.state)
    expect(late.effects).toEqual([{ type: "url.revoke", url: "blob:late" }])
  })

  test("only a shown embed captures, and a cover that ends before the still paints gives it up", () => {
    expect(transitionEmbedSnapshot(INITIAL_SNAPSHOT_STATE, sync(true, { shown: false })).state).toBe(
      INITIAL_SNAPSHOT_STATE,
    )
    expect(transitionEmbedSnapshot(capturing, sync(true, { shown: false })).state).toBe(capturing)
    expect(transitionEmbedSnapshot(capturing, sync(false)).effects).toEqual([{ type: "capture-timer.stop" }])
    expect(transitionEmbedSnapshot(painting, sync(false)).effects).toEqual([
      { type: "paint-timer.stop" },
      { type: "url.revoke", url: "blob:a" },
    ])
  })

  test("stale timers and paints of another still change nothing", () => {
    expect(transitionEmbedSnapshot(painting, { type: "snapshot.painted", url: "blob:other" }).state).toBe(painting)
    expect(transitionEmbedSnapshot(painting, { type: "paint.timeout", attempt: 0 }).state).toBe(painting)
    expect(transitionEmbedSnapshot(capturing, { type: "capture.timeout", attempt: 0 }).state).toBe(capturing)
    expect(transitionEmbedSnapshot(frozen, { type: "paint.timeout", attempt: 1 }).state).toBe(frozen)
  })
})

describe("exits", () => {
  test("a box that hides or loses its embed gives up the still from every phase", () => {
    for (const state of [capturing, painting, frozen, thawing]) {
      for (const event of [sync(true, { visible: false, shown: false }), sync(true, { id: undefined })]) {
        const next = transitionEmbedSnapshot(state, event)
        expect(next.state.status).toBe("live")
        expect(selectSnapshotUrl(next.state, "embed-Alpha", true)).toBeUndefined()

        if (state.status !== "capturing") expect(next.effects).toContainEqual({ type: "url.revoke", url: "blob:a" })
      }
    }
  })

  test("steady frames keep the same state and need no event", () => {
    const steady: [EmbedSnapshotState, EmbedSnapshotEvent][] = [
      [INITIAL_SNAPSHOT_STATE, sync(false)],
      [capturing, sync(true)],
      [painting, sync(true)],
      [frozen, sync(true)],
      [frozen, sync(true, { shown: false })],
      [thawing, sync(false)],
    ]

    for (const [state, event] of steady) {
      if (event.type !== "sync") throw new Error("Expected a sync")
      expect(selectSnapshotNeedsSync(state, event.id, event.visible, event.shown, event.covered)).toBe(false)
      const next = transitionEmbedSnapshot(state, event)
      expect(next.state).toBe(state)
      expect(next.effects).toEqual([])
    }

    expect(selectSnapshotNeedsSync(frozen, "embed-Alpha", true, true, false)).toBe(true)
  })

  test("disposal stops the active timer, gives up the still, and gives up a late one", () => {
    expect(transitionEmbedSnapshot(capturing, { type: "disposed" })).toEqual({
      state: DISPOSED_SNAPSHOT_STATE,
      effects: [{ type: "capture-timer.stop" }],
    })
    expect(transitionEmbedSnapshot(painting, { type: "disposed" }).effects).toEqual([
      { type: "paint-timer.stop" },
      { type: "url.revoke", url: "blob:a" },
    ])
    expect(transitionEmbedSnapshot(thawing, { type: "disposed" }).effects).toEqual([
      { type: "thaw-timer.stop" },
      { type: "url.revoke", url: "blob:a" },
    ])

    const late = transitionEmbedSnapshot(DISPOSED_SNAPSHOT_STATE, settled(1, "blob:late"))
    expect(late.state).toBe(DISPOSED_SNAPSHOT_STATE)
    expect(late.effects).toEqual([{ type: "url.revoke", url: "blob:late" }])
    expect(transitionEmbedSnapshot(DISPOSED_SNAPSHOT_STATE, sync(true)).state).toBe(DISPOSED_SNAPSHOT_STATE)
  })
})

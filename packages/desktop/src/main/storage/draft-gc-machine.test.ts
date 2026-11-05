import { describe, expect, test } from "bun:test"
import {
  BLOB_GRACE_MS,
  COLLECT_INTERVAL_MS,
  initialDraftGcTransition,
  transitionDraftGc,
  type DraftGcEvent,
  type DraftGcState,
  type DraftGcTransition,
} from "./draft-gc-machine"

const replay = (events: readonly DraftGcEvent[], from: DraftGcState) =>
  events.reduce<DraftGcTransition>(
    (result, event) => {
      const next = transitionDraftGc(result.state, event)

      return { state: next.state, commands: [...result.commands, ...next.commands] }
    },
    { state: from, commands: [] },
  )

const opened = initialDraftGcTransition(0, 10_000)

// The startup sweep ran at 10 s and left nothing unreferenced.
const clean = replay(
  [
    { type: "timer.fired", attempt: 1, at: 10_000 },
    { type: "collect.succeeded", attempt: 2, at: 10_000, oldestOrphanAt: null },
  ],
  opened.state,
).state

describe("draft blob GC machine", () => {
  test("the startup sweep runs once the delay passes and leaves nothing armed when no orphan remains", () => {
    expect(opened.commands).toEqual([{ type: "start-timer", attempt: 1, delayMs: 10_000 }])
    expect(clean).toEqual({ status: "clean", attempt: 2, lastCollectedAt: 10_000 })
  })

  test("a document write after a clean sweep collects again, though no blob was uploaded", () => {
    const at = 10_000 + BLOB_GRACE_MS + 1

    expect(transitionDraftGc(clean, { type: "documents.written", at })).toEqual({
      state: { status: "collecting", attempt: 3 },
      commands: [{ type: "cancel-timer" }, { type: "collect", attempt: 3, at, before: at - BLOB_GRACE_MS }],
    })
  })

  test("a document write within the interval schedules the sweep for when the interval ends", () => {
    expect(transitionDraftGc(clean, { type: "documents.written", at: 30_000 })).toEqual({
      state: { status: "scheduled", attempt: 3, lastCollectedAt: 10_000, dueAt: 10_000 + COLLECT_INTERVAL_MS },
      commands: [{ type: "start-timer", attempt: 3, delayMs: COLLECT_INTERVAL_MS - 20_000 }],
    })
  })

  test("an orphan kept inside the grace period keeps a sweep armed for when the grace ends", () => {
    const collecting = transitionDraftGc(clean, { type: "documents.written", at: 70_000 }).state
    const dueAt = 500 + BLOB_GRACE_MS + 1

    const kept = transitionDraftGc(collecting, {
      type: "collect.succeeded",
      attempt: 3,
      at: 70_000,
      oldestOrphanAt: 500,
    })
    expect(kept).toEqual({
      state: { status: "scheduled", attempt: 4, lastCollectedAt: 70_000, dueAt },
      commands: [{ type: "start-timer", attempt: 4, delayMs: dueAt - 70_000 }],
    })

    // Idle: the timer sweeps it.
    expect(transitionDraftGc(kept.state, { type: "timer.fired", attempt: 4, at: dueAt }).commands).toEqual([
      { type: "cancel-timer" },
      { type: "collect", attempt: 5, at: dueAt, before: dueAt - BLOB_GRACE_MS },
    ])
  })

  test("a typing burst inside the interval leaves the armed sweep alone", () => {
    const scheduled = transitionDraftGc(clean, { type: "documents.written", at: 30_000 }).state

    const burst = [31_000, 32_000, 40_000].map((at) =>
      transitionDraftGc(scheduled, { type: "documents.written", at }),
    )
    burst.forEach((next) => expect(next).toEqual({ state: scheduled, commands: [] }))
    burst.forEach((next) => expect(next.state).toBe(scheduled))
    expect(transitionDraftGc(scheduled, { type: "blob.uploaded", at: 41_000 }).state).toBe(scheduled)
  })

  test("an upload after a clean sweep arms a sweep for when its grace ends", () => {
    expect(transitionDraftGc(clean, { type: "blob.uploaded", at: 20_000 })).toEqual({
      state: { status: "scheduled", attempt: 3, lastCollectedAt: 10_000, dueAt: 20_000 + BLOB_GRACE_MS + 1 },
      commands: [{ type: "start-timer", attempt: 3, delayMs: BLOB_GRACE_MS + 1 }],
    })
  })

  test("a failed sweep reports the error and retries after the interval", () => {
    const error = new Error("disk I/O error")
    const collecting = transitionDraftGc(clean, { type: "documents.written", at: 70_000 }).state

    expect(transitionDraftGc(collecting, { type: "collect.failed", attempt: 3, at: 70_000, error })).toEqual({
      state: { status: "scheduled", attempt: 4, lastCollectedAt: 70_000, dueAt: 70_000 + COLLECT_INTERVAL_MS },
      commands: [
        { type: "start-timer", attempt: 4, delayMs: COLLECT_INTERVAL_MS },
        { type: "report-error", error },
      ],
    })
  })

  test.each([
    { name: "a timer from a replaced schedule", from: opened.state, event: { type: "timer.fired", attempt: 0, at: 1 } },
    { name: "a sweep result while scheduled", from: opened.state, event: { type: "collect.succeeded", attempt: 1, at: 1, oldestOrphanAt: null } },
    { name: "a timer while clean", from: clean, event: { type: "timer.fired", attempt: 2, at: 1 } },
    {
      name: "a stale sweep result",
      from: transitionDraftGc(clean, { type: "documents.written", at: 70_000 }).state,
      event: { type: "collect.succeeded", attempt: 2, at: 1, oldestOrphanAt: null },
    },
  ] satisfies { name: string; from: DraftGcState; event: DraftGcEvent }[])("$name is ignored", (row) => {
    expect(transitionDraftGc(row.from, row.event)).toEqual({ state: row.from, commands: [] })
  })

  test("closing cancels the armed sweep, and the final flush then collects nothing", () => {
    const closed = transitionDraftGc(opened.state, { type: "close.requested" })
    expect(closed).toEqual({ state: { status: "closed" }, commands: [{ type: "cancel-timer" }] })

    expect(transitionDraftGc(closed.state, { type: "documents.written", at: BLOB_GRACE_MS * 2 }).state).toBe(closed.state)
    expect(transitionDraftGc(closed.state, { type: "timer.fired", attempt: 1, at: 1 }).state).toBe(closed.state)
  })
})

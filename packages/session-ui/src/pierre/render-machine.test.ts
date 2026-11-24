import { describe, expect, test } from "bun:test"
import { Virtualizer } from "@pierre/diffs"
import type { WorkerPoolManager } from "@pierre/diffs/worker"
import { normalize } from "../components/session-diff"
import {
  diffExpectsRows,
  DISPOSED_VIEWER_RENDER_STATE,
  INITIAL_VIEWER_RENDER_STATE,
  needsInstanceReset,
  NO_RENDER_EFFECTS,
  selectMountedSpec,
  transitionViewerRender,
  type PoolReadiness,
  type ViewerInstanceSpec,
  type ViewerRenderEvent,
  type ViewerRenderRequest,
  type ViewerRenderTransition,
  type ViewerTarget,
} from "./render-machine"

// SAFETY: the machine only compares pools by identity; it never calls them.
const poolA = {} as WorkerPoolManager

// SAFETY: as above.
const poolB = {} as WorkerPoolManager

const virtualizer = new Virtualizer()

const files = (before: string, after: string): ViewerTarget => ({
  kind: "diff-files",
  before: { name: "a.ts", contents: before, cacheKey: before },
  after: { name: "a.ts", contents: after, cacheKey: after },
})

const spec = (target: ViewerTarget, change: Partial<ViewerInstanceSpec> = {}): ViewerInstanceSpec => ({
  virtualizer: undefined,
  workerPool: undefined,
  hunkSeparators: undefined,
  target,
  ...change,
})

const requested = (
  next: ViewerInstanceSpec,
  change: Partial<Omit<ViewerRenderRequest, "spec">> = {},
): ViewerRenderEvent => ({
  type: "render.requested",
  request: { spec: next, pool: "none", settleFrames: 1, preserveHeight: true, expectsRows: true, ...change },
})

function run(events: ViewerRenderEvent[], state = INITIAL_VIEWER_RENDER_STATE): ViewerRenderTransition {
  return events.reduce((result, event) => transitionViewerRender(result.state, event), {
    state,
    effects: NO_RENDER_EFFECTS,
  })
}

const frames = (attempt: number, count: number) =>
  Array.from({ length: count }, () => ({ type: "settle.frame", attempt }) as const)

describe("viewer render", () => {
  test("an in-place update records the drawn target, so a later virtualized draw compares against it", () => {
    const first = spec(files("a1", "b1"))
    const second = spec(files("a2", "b2"))
    const updated = run([requested(first), requested(second)])

    expect(updated.effects).toContainEqual({ type: "draw", action: "update", spec: second })
    expect(selectMountedSpec(updated.state)).toBe(second)

    const virtualized = run([requested({ ...second, virtualizer })], updated.state)
    expect(virtualized.effects).toContainEqual({ type: "draw", action: "reset", spec: { ...second, virtualizer } })

    const same = run([requested(spec(files("a2", "b2"), { virtualizer }))], virtualized.state)
    expect(same.effects).toContainEqual(expect.objectContaining({ type: "draw", action: "update" }))

    const reverted = run([requested(spec(files("a1", "b1"), { virtualizer }))], same.state)
    expect(reverted.effects).toContainEqual(expect.objectContaining({ type: "draw", action: "reset" }))
  })

  test("decides when an instance must be rebuilt", () => {
    const text = (contents: string) => ({ kind: "text", file: { name: "a.ts", contents } }) as const

    const cases: [ViewerInstanceSpec, ViewerInstanceSpec, boolean][] = [
      [spec(text("a")), spec(text("b")), false],
      [spec(text("a")), spec(text("a"), { virtualizer }), true],
      [spec(text("a"), { workerPool: poolA }), spec(text("a"), { workerPool: poolB }), true],
      [spec(files("a", "b")), spec(files("a", "c")), false],
      [spec(files("a", "b"), { virtualizer }), spec(files("a", "c"), { virtualizer }), true],
      [spec(files("a", "b"), { virtualizer }), spec(files("a", "b"), { virtualizer, hunkSeparators: "simple" }), true],
      [spec(files("a", "b"), { virtualizer }), spec(files("a", "b"), { virtualizer }), false],
    ]

    for (const [previous, next, reset] of cases) expect(needsInstanceReset(previous, next)).toBe(reset)
  })

  test("waits for each pool a virtualized draw needs, even after another pool settled", () => {
    const ready = run([requested(spec(files("a", "b"), { virtualizer, workerPool: poolA }), { pool: "ready" })])
    expect(ready.state.status).toBe("awaiting-rows")

    const large = run(
      [requested(spec(files("a", "c"), { virtualizer, workerPool: poolB }), { pool: "initializing" })],
      ready.state,
    )

    expect(large.state).toMatchObject({ status: "awaiting-pool", attempt: 2 })
    expect(large.effects).toEqual([{ type: "cancel-async" }, { type: "await-pool", attempt: 2, pool: poolB }])

    expect(transitionViewerRender(large.state, { type: "pool.settled", attempt: 1, ok: true }).state).toBe(large.state)

    const settled = transitionViewerRender(large.state, { type: "pool.settled", attempt: 2, ok: true })
    expect(settled.effects).toContainEqual(
      expect.objectContaining({ type: "draw", action: "reset", spec: expect.objectContaining({ workerPool: poolB }) }),
    )
  })

  test("a failed or hung pool falls back to the main thread", () => {
    const waiting = run([
      requested(spec(files("a", "b"), { virtualizer, workerPool: poolB }), { pool: "initializing" }),
    ])

    const failed = transitionViewerRender(waiting.state, { type: "pool.settled", attempt: 1, ok: false })
    expect(selectMountedSpec(failed.state)?.workerPool).toBeUndefined()

    const timedOut = transitionViewerRender(waiting.state, { type: "pool.timed-out", attempt: 1 })
    expect(selectMountedSpec(timedOut.state)?.workerPool).toBeUndefined()
    expect(timedOut.state).toMatchObject({ timedOutPool: poolB })

    // The timed-out pool does not block the next draw, until it reports ready.
    const next = (pool: PoolReadiness) =>
      transitionViewerRender(
        timedOut.state,
        requested(spec(files("a", "c"), { virtualizer, workerPool: poolB }), { pool }),
      )

    expect(next("initializing").state.status).toBe("awaiting-rows")
    expect(selectMountedSpec(next("initializing").state)?.workerPool).toBeUndefined()
    expect(next("ready").state).toMatchObject({ timedOutPool: undefined })
    expect(selectMountedSpec(next("ready").state)?.workerPool).toBe(poolB)

    const broken = run([requested(spec(files("a", "b"), { virtualizer, workerPool: poolA }), { pool: "broken" })])
    expect(selectMountedSpec(broken.state)?.workerPool).toBeUndefined()
  })

  test("an empty diff settles without waiting for rows and releases the pinned height", () => {
    const shown = run([requested(spec(files("a", "b"))), { type: "rows.ready", attempt: 1 }, ...frames(1, 2)])
    expect(shown.state).toMatchObject({ status: "ready", heightPinned: false })

    const empty = run([requested(spec(files("a", "a")), { expectsRows: false })], shown.state)
    expect(empty.effects).toEqual([
      { type: "preserve-height" },
      expect.objectContaining({ type: "draw", action: "update" }),
      { type: "sync-annotations" },
      { type: "schedule-settle-frame", attempt: 2 },
    ])

    const settled = run(frames(2, 2), empty.state)
    expect(settled.state).toMatchObject({ status: "ready", outcome: "ready", heightPinned: false })
    expect(settled.effects).toEqual([
      { type: "release-height" },
      { type: "reapply-selection" },
      { type: "refresh-find" },
      { type: "notify-rendered" },
    ])
  })

  test("knows which diffs draw no rows", () => {
    const empty = normalize({ file: "a.ts", before: "same\n", after: "same\n", additions: 0, deletions: 0 })
    const changed = normalize({ file: "a.ts", before: "a\n", after: "b\n", additions: 1, deletions: 1 })

    expect(diffExpectsRows({ kind: "diff-patch", fileDiff: empty.fileDiff }, false)).toBe(false)
    expect(diffExpectsRows({ kind: "diff-patch", fileDiff: changed.fileDiff }, false)).toBe(true)
    expect(diffExpectsRows(files("same", "same"), false)).toBe(false)
    expect(diffExpectsRows(files("same", "same"), true)).toBe(true)
    expect(diffExpectsRows({ kind: "diff-empty" }, true)).toBe(false)
  })

  test("rows that never appear time out, and late rows still finish the draw", () => {
    const waiting = run([requested(spec(files("a", "b")))])
    const timedOut = transitionViewerRender(waiting.state, { type: "rows.timed-out", attempt: 1 })

    expect(timedOut.state).toMatchObject({ status: "ready", outcome: "timeout", heightPinned: false })
    expect(timedOut.effects).toEqual([
      { type: "release-height" },
      { type: "reapply-selection" },
      { type: "refresh-find" },
      { type: "notify-rendered" },
    ])

    const late = run([{ type: "rows.ready", attempt: 1 }, ...frames(1, 2)], timedOut.state)
    expect(late.state).toMatchObject({ status: "ready", outcome: "ready" })
    expect(late.effects).toEqual([{ type: "reapply-selection" }, { type: "refresh-find" }, { type: "notify-rendered" }])

    // The next draw stops the row watch the timeout left running.
    expect(run([requested(spec(files("a", "c")))], timedOut.state).effects[0]).toEqual({ type: "cancel-async" })
  })

  test("streamed draws keep the height pinned until the last one settles", () => {
    const first = run([requested(spec(files("a", "b")))])
    expect(first.effects[0]).toEqual({ type: "preserve-height" })

    const second = transitionViewerRender(first.state, requested(spec(files("a", "bc"))))
    expect(second.effects).toEqual([
      { type: "cancel-async" },
      expect.objectContaining({ type: "draw", action: "update" }),
      { type: "sync-annotations" },
      { type: "watch-rows", attempt: 2 },
    ])

    expect(transitionViewerRender(second.state, { type: "rows.ready", attempt: 1 }).state).toBe(second.state)

    const done = run([{ type: "rows.ready", attempt: 2 }, ...frames(2, 1)], second.state)
    expect(done.state).toMatchObject({ status: "settling", framesLeft: 1, heightPinned: true })

    const ready = run(frames(2, 1), done.state)
    expect(ready.effects.filter((effect) => effect.type === "release-height")).toHaveLength(1)
  })

  test("waits one frame per settle frame plus one, and ignores stale frames", () => {
    const quick = run([requested(spec(files("a", "b")), { settleFrames: 0 }), { type: "rows.ready", attempt: 1 }])
    expect(transitionViewerRender(quick.state, { type: "settle.frame", attempt: 0 }).state).toBe(quick.state)
    expect(run(frames(1, 1), quick.state).state.status).toBe("ready")

    const slow = run([requested(spec(files("a", "b"))), { type: "rows.ready", attempt: 1 }])
    expect(run(frames(1, 1), slow.state).state.status).toBe("settling")
    expect(run(frames(1, 2), slow.state).state.status).toBe("ready")
  })

  test("annotations apply only when there are some or some were applied since the draw", () => {
    expect(transitionViewerRender(INITIAL_VIEWER_RENDER_STATE, { type: "annotations.synced", count: 2 }).effects).toBe(
      NO_RENDER_EFFECTS,
    )

    const drawn = run([requested(spec(files("a", "b")))])
    const none = transitionViewerRender(drawn.state, { type: "annotations.synced", count: 0 })
    expect(none.state).toBe(drawn.state)
    expect(none.effects).toBe(NO_RENDER_EFFECTS)

    const added = run([{ type: "annotations.synced", count: 2 }], drawn.state)
    expect(added.effects).toEqual([{ type: "apply-annotations" }])

    const cleared = run([{ type: "annotations.synced", count: 0 }], added.state)
    expect(cleared.effects).toEqual([{ type: "apply-annotations" }])

    // A draw renders without annotations, so it syncs them again from scratch.
    const redrawn = run([requested(spec(files("a", "c"))), { type: "annotations.synced", count: 0 }], added.state)
    expect(redrawn.effects).toBe(NO_RENDER_EFFECTS)
  })

  test("a reveal waits for a mounted, ready draw and stops once it lands", () => {
    const range = { start: 400, end: 400, side: "additions" } as const
    const pending = transitionViewerRender(INITIAL_VIEWER_RENDER_STATE, { type: "reveal.requested", range })
    expect(pending.effects).toBe(NO_RENDER_EFFECTS)

    const ready = run(
      [requested(spec(files("a", "b"))), { type: "rows.ready", attempt: 1 }, ...frames(1, 2)],
      pending.state,
    )

    expect(ready.effects).toContainEqual({ type: "try-reveal", range })

    const landed = run(
      [
        { type: "reveal.completed" },
        requested(spec(files("a", "c"))),
        { type: "rows.ready", attempt: 2 },
        ...frames(2, 2),
      ],
      ready.state,
    )

    expect(landed.effects).not.toContainEqual(expect.objectContaining({ type: "try-reveal" }))
  })

  test("disposing releases the height and instance and ignores later results", () => {
    const waiting = run([requested(spec(files("a", "b")))])
    const disposed = transitionViewerRender(waiting.state, { type: "disposed" })

    expect(disposed.state).toBe(DISPOSED_VIEWER_RENDER_STATE)
    expect(disposed.effects).toEqual([
      { type: "cancel-async" },
      { type: "release-height" },
      { type: "cleanup-instance" },
    ])

    for (const event of [
      { type: "rows.ready", attempt: 1 },
      { type: "pool.settled", attempt: 1, ok: true },
      requested(spec(files("a", "c"))),
    ] as const)
      expect(transitionViewerRender(disposed.state, event).effects).toBe(NO_RENDER_EFFECTS)
  })
})

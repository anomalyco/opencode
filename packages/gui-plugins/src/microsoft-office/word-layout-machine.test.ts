import { describe, expect, test } from "bun:test"
import {
  WORD_INITIAL_BLOCK_COST_MS,
  WORD_MAX_STEP_BLOCKS,
  createWordLayoutState,
  createWorkerLayoutState,
  mergeWordPages,
  stepBlocks,
  transitionWordLayout,
  transitionWorkerLayout,
  wordLayoutFailed,
  wordLayoutIncomplete,
  wordLayoutLoading,
  wordLayoutPages,
  workerLayoutComplete,
  type WordLayoutEvent,
  type WordLayoutState,
  type WordLayoutTransition,
} from "./word-layout-machine"

const page = (height: number) => ({ width: 816, height, background: undefined })

// Folds the events in order and returns the last transition.
const replay = (events: readonly WordLayoutEvent[], state: WordLayoutState) =>
  events.reduce<WordLayoutTransition>((last, event) => transitionWordLayout(last.state, event), { state, effects: [] })

const longDocument = () => createWordLayoutState({ pages: [page(1056), page(1056), page(1056)], loading: true })

describe("transitionWordLayout", () => {
  test("a pane that never paints keeps the layout at the prefix, and the first paint starts it behind its paints", () => {
    const prefix = longDocument()

    expect(prefix.status).toBe("prefix")
    expect(wordLayoutLoading(prefix)).toBe(true)

    const painted = transitionWordLayout(prefix, { type: "paint.queued" })

    expect(painted).toEqual({
      state: { status: "laying-out", pages: wordLayoutPages(prefix), attempt: 1 },
      effects: [{ type: "start-step", attempt: 1, defer: true }],
    })

    const again = transitionWordLayout(painted.state, { type: "paint.queued" })

    expect(again.state).toBe(painted.state)
    expect(again.effects).toEqual([])
  })

  test("a short document starts complete and never lays out", () => {
    const complete = createWordLayoutState({ pages: [page(1056)], loading: false })

    expect(complete.status).toBe("complete")
    expect(wordLayoutLoading(complete)).toBe(false)
    expect(wordLayoutIncomplete(complete)).toBe(false)
    expect(transitionWordLayout(complete, { type: "paint.queued" }).state).toBe(complete)
    expect(transitionWordLayout(complete, { type: "layout.requested" }).state).toBe(complete)
  })

  test("each step that leaves more asks for the next one", () => {
    const laying = replay([{ type: "paint.queued" }], longDocument())
    const progressed = transitionWordLayout(laying.state, { type: "step.progressed", attempt: 1 })

    expect(progressed.state).toBe(laying.state)
    expect(progressed.effects).toEqual([{ type: "start-step", attempt: 1, defer: false }])
  })

  test("a failed step keeps the pages, stops the loader and lets a bookmark try again", () => {
    const prefix = longDocument()
    const failed = replay([{ type: "paint.queued" }, { type: "step.failed", attempt: 1 }], prefix)

    expect(failed).toEqual({
      state: { status: "failed", pages: wordLayoutPages(prefix), attempt: 1 },
      effects: [{ type: "resolve-waiters", completed: false }],
    })
    expect(wordLayoutLoading(failed.state)).toBe(false)
    expect(wordLayoutIncomplete(failed.state)).toBe(true)

    // Scrolling on does not hammer a failing layout.
    expect(transitionWordLayout(failed.state, { type: "paint.queued" }).state).toBe(failed.state)

    const retry = transitionWordLayout(failed.state, { type: "layout.requested" })

    expect(retry).toEqual({
      state: { status: "laying-out", pages: wordLayoutPages(prefix), attempt: 2 },
      effects: [{ type: "start-step", attempt: 2, defer: false }],
    })

    const full = [page(1056), page(1056), page(1056), page(900)]

    const completed = transitionWordLayout(retry.state, {
      type: "step.completed",
      attempt: 2,
      pages: full,
      kept: [true, true, true, false],
    })

    expect(completed.state.status).toBe("complete")
    expect(completed.effects).toEqual([
      { type: "report-details", pageCount: 4 },
      { type: "resolve-waiters", completed: true },
    ])
  })

  test("a slow step keeps the loader up until it lands, so the first pages never pass for the whole document", () => {
    const laying = replay([{ type: "paint.queued" }], longDocument())

    // No step carries a deadline: the worker runs it synchronously and cannot be stopped, only discarded.
    expect(laying.effects).toEqual([{ type: "start-step", attempt: 1, defer: true }])
    expect(wordLayoutLoading(laying.state)).toBe(true)
    expect(wordLayoutFailed(laying.state)).toBe(false)

    const completed = transitionWordLayout(laying.state, {
      type: "step.completed",
      attempt: 1,
      pages: [page(1056), page(1056), page(1056), page(1056)],
      kept: [true, true, true, false],
    })

    expect(completed.state.status).toBe("complete")
    expect(completed.effects).toEqual([
      { type: "report-details", pageCount: 4 },
      { type: "resolve-waiters", completed: true },
    ])
  })

  test("a step that throws shows the notice, and Retry starts a new run", () => {
    const failed = replay([{ type: "paint.queued" }, { type: "step.failed", attempt: 1 }], longDocument())

    expect(wordLayoutFailed(failed.state)).toBe(true)
    expect(wordLayoutLoading(failed.state)).toBe(false)

    // Retry dispatches the same event a bookmark past the laid-out pages does.
    const retry = transitionWordLayout(failed.state, { type: "layout.requested" })

    expect(retry.effects).toEqual([{ type: "start-step", attempt: 2, defer: false }])
    expect(wordLayoutFailed(retry.state)).toBe(false)
    expect(wordLayoutLoading(retry.state)).toBe(true)
  })

  test("a bookmark before the first paint starts the layout at once", () => {
    expect(transitionWordLayout(longDocument(), { type: "layout.requested" }).effects).toEqual([
      { type: "start-step", attempt: 1, defer: false },
    ])

    const laying = replay([{ type: "paint.queued" }], longDocument())

    expect(transitionWordLayout(laying.state, { type: "layout.requested" }).state).toBe(laying.state)
  })

  test("replies of an earlier run, or out of phase, change nothing", () => {
    const retry = replay(
      [{ type: "paint.queued" }, { type: "step.failed", attempt: 1 }, { type: "layout.requested" }],
      longDocument(),
    )

    for (const event of [
      { type: "step.progressed", attempt: 1 },
      { type: "step.failed", attempt: 1 },
      { type: "step.completed", attempt: 1, pages: [page(1)], kept: [false] },
    ] satisfies WordLayoutEvent[]) {
      const stale = transitionWordLayout(retry.state, event)

      expect(stale.state).toBe(retry.state)
      expect(stale.effects).toEqual([])
    }

    const prefix = longDocument()

    expect(transitionWordLayout(prefix, { type: "step.progressed", attempt: 1 }).state).toBe(prefix)
  })

  test("disposal withdraws the step, answers waiting bookmarks and ignores everything after it", () => {
    const disposed = replay([{ type: "paint.queued" }, { type: "disposed" }], longDocument())

    expect(disposed).toEqual({
      state: { status: "disposed" },
      effects: [
        { type: "end-step", attempt: 1 },
        { type: "resolve-waiters", completed: false },
      ],
    })
    expect(transitionWordLayout(longDocument(), { type: "disposed" }).effects).toEqual([
      { type: "resolve-waiters", completed: false },
    ])
    expect(wordLayoutPages(disposed.state)).toEqual([])
    expect(wordLayoutIncomplete(disposed.state)).toBe(false)

    for (const event of [
      { type: "paint.queued" },
      { type: "layout.requested" },
      { type: "step.completed", attempt: 1, pages: [page(1)], kept: [false] },
      { type: "disposed" },
    ] satisfies WordLayoutEvent[]) {
      const after = transitionWordLayout(disposed.state, event)

      expect(after.state).toBe(disposed.state)
      expect(after.effects).toEqual([])
    }
  })
})

describe("mergeWordPages", () => {
  test("a page the full layout kept keeps its object; a changed or new page takes the new one", () => {
    const previous = [page(1056), page(1056), page(1056)]
    const next = [page(1056), page(1056), page(1000), page(1056)]
    const merged = mergeWordPages(previous, next, [true, false, true, false])

    expect(merged[0]).toBe(previous[0])
    // Not kept by the engine, even at the same size.
    expect(merged[1]).toBe(next[1])
    // Kept by the engine, but a new size.
    expect(merged[2]).toBe(next[2])
    expect(merged[3]).toBe(next[3])
  })
})

describe("transitionWorkerLayout", () => {
  test("a step that throws returns the cursor to the prefix, so the retry begins the layout again", () => {
    const begun = transitionWorkerLayout(createWorkerLayoutState(true), {
      type: "step.progressed",
      elapsedMs: 40,
      blocks: 0,
    })

    expect(begun).toEqual({ status: "stepping", cost: WORD_INITIAL_BLOCK_COST_MS })

    const failed = transitionWorkerLayout(begun, { type: "step.failed" })

    expect(failed).toEqual({ status: "prefix" })
    expect(workerLayoutComplete(failed)).toBe(false)
    expect(transitionWorkerLayout(failed, { type: "step.failed" })).toBe(failed)
  })

  test("the block cost follows a running average, and the step size follows the cost", () => {
    const stepping = transitionWorkerLayout(
      { status: "stepping", cost: 3 },
      { type: "step.progressed", elapsedMs: 80, blocks: 8 },
    )

    expect(stepping).toEqual({ status: "stepping", cost: 3 * 0.7 + 10 * 0.3 })
    expect(stepBlocks(3)).toBe(8)
    expect(stepBlocks(1000)).toBe(1)
    expect(stepBlocks(0.0001)).toBe(WORD_MAX_STEP_BLOCKS)
  })

  test("only a complete layout releases pages, and it stays complete", () => {
    const short = createWorkerLayoutState(false)

    expect(workerLayoutComplete(short)).toBe(true)
    expect(transitionWorkerLayout(short, { type: "step.failed" })).toBe(short)

    const completed = transitionWorkerLayout({ status: "stepping", cost: 3 }, { type: "step.completed" })

    expect(workerLayoutComplete(completed)).toBe(true)
    expect(workerLayoutComplete(createWorkerLayoutState(true))).toBe(false)
  })
})

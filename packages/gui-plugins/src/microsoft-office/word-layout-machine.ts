import type { WordPageSize } from "./word-protocol"

/** How long one layout step may run before the window stops waiting for the rest of the document. */
export const WORD_LAYOUT_STEP_TIMEOUT_MS = 60_000

/** How long one worker step may hold back a paint that waits behind it, in milliseconds. */
export const WORD_STEP_BUDGET_MS = 24

/** What a body block is assumed to cost before the first step measures it, in milliseconds. */
export const WORD_INITIAL_BLOCK_COST_MS = 3

/** The most body blocks one step lays out, however cheap they were. */
export const WORD_MAX_STEP_BLOCKS = 8192

/**
 * The window's view of a Word document's layout. The worker opens a document with its first pages laid out; a long one
 * lays out the rest a step at a time once the first pages asked for their paints, or at once when a bookmark needs it.
 * Each run of steps takes the next attempt number, so a reply whose attempt the state no longer holds is stale.
 */
export type WordLayoutState =
  /** Only the first pages are laid out, and no paint has asked for any yet. */
  | { readonly status: "prefix"; readonly pages: readonly WordPageSize[] }
  /** The rest of the document lays out, a step at a time. */
  | { readonly status: "laying-out"; readonly pages: readonly WordPageSize[]; readonly attempt: number }
  | { readonly status: "complete"; readonly pages: readonly WordPageSize[] }
  /** A step failed or hung: the pages laid out so far stay readable, and a bookmark past them tries again. */
  | { readonly status: "failed"; readonly pages: readonly WordPageSize[]; readonly attempt: number }
  | { readonly status: "disposed" }

export type WordLayoutEvent =
  /** A page asked the worker for its paint. */
  | { readonly type: "paint.queued" }
  /** A bookmark is not in the pages laid out so far. */
  | { readonly type: "layout.requested" }
  /** A step laid out more of the document, and more is left. */
  | { readonly type: "step.progressed"; readonly attempt: number }
  /** `kept` tells, per page, whether the full layout left the page shown so far unchanged. */
  | {
      readonly type: "step.completed"
      readonly attempt: number
      readonly pages: readonly WordPageSize[]
      readonly kept: readonly boolean[]
    }
  | { readonly type: "step.failed"; readonly attempt: number }
  | { readonly type: "step.timed-out"; readonly attempt: number }
  | { readonly type: "disposed" }

export type WordLayoutEffect =
  /**
   * Ends the attempt's previous step, arms its timeout and asks the worker for one step. `defer` waits a microtask, so
   * every paint the first pages ask for in the same task reaches the worker's queue ahead of the step.
   */
  | { readonly type: "start-step"; readonly attempt: number; readonly defer: boolean; readonly timeoutMs: number }
  /** Clears the attempt's timeout and withdraws its step. */
  | { readonly type: "end-step"; readonly attempt: number }
  | { readonly type: "report-details"; readonly pageCount: number }
  /** Answers the bookmarks waiting for the layout: `completed` when the whole document is laid out. */
  | { readonly type: "resolve-waiters"; readonly completed: boolean }

export type WordLayoutTransition = { readonly state: WordLayoutState; readonly effects: readonly WordLayoutEffect[] }

const NONE: readonly WordLayoutEffect[] = []

export function createWordLayoutState(first: {
  readonly pages: readonly WordPageSize[]
  readonly loading: boolean
}): WordLayoutState {
  return first.loading ? { status: "prefix", pages: first.pages } : { status: "complete", pages: first.pages }
}

export function transitionWordLayout(state: WordLayoutState, event: WordLayoutEvent): WordLayoutTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects:
        state.status === "laying-out"
          ? [
              { type: "end-step", attempt: state.attempt },
              { type: "resolve-waiters", completed: false },
            ]
          : [{ type: "resolve-waiters", completed: false }],
    }

  // The first paint starts the rest of the layout; a failed layout waits for a bookmark rather than retrying on every
  // scroll.
  if (event.type === "paint.queued") return state.status === "prefix" ? start(state, 1, true) : { state, effects: NONE }

  if (event.type === "layout.requested") {
    if (state.status === "prefix") return start(state, 1, false)

    if (state.status === "failed") return start(state, state.attempt + 1, false)

    return { state, effects: NONE }
  }

  if (state.status !== "laying-out" || event.attempt !== state.attempt) return { state, effects: NONE }

  if (event.type === "step.progressed")
    return {
      state,
      effects: [{ type: "start-step", attempt: state.attempt, defer: false, timeoutMs: WORD_LAYOUT_STEP_TIMEOUT_MS }],
    }

  if (event.type === "step.completed") {
    const pages = mergeWordPages(state.pages, event.pages, event.kept)

    return {
      state: { status: "complete", pages },
      effects: [
        { type: "end-step", attempt: state.attempt },
        { type: "report-details", pageCount: pages.length },
        { type: "resolve-waiters", completed: true },
      ],
    }
  }

  return {
    state: { status: "failed", pages: state.pages, attempt: state.attempt },
    effects: [
      { type: "end-step", attempt: state.attempt },
      { type: "resolve-waiters", completed: false },
    ],
  }
}

/**
 * The full layout's pages, where a page the full layout left unchanged keeps its object, and so its bitmap and text
 * layer. A changed page gets the new object, keeps its row and paints again over its old bitmap.
 */
export function mergeWordPages(
  previous: readonly WordPageSize[],
  pages: readonly WordPageSize[],
  kept: readonly boolean[],
) {
  return pages.map((page, index) => {
    const size = previous[index]

    return size &&
      kept[index] &&
      size.width === page.width &&
      size.height === page.height &&
      size.background === page.background
      ? size
      : page
  })
}

/** The pages the column shows. */
export function wordLayoutPages(state: WordLayoutState): readonly WordPageSize[] {
  return state.status === "disposed" ? [] : state.pages
}

/** Whether the last page shows the loader for the pages still to come. */
export function wordLayoutLoading(state: WordLayoutState) {
  return state.status === "prefix" || state.status === "laying-out"
}

/** Whether a bookmark not found so far may still turn up once the layout runs. */
export function wordLayoutIncomplete(state: WordLayoutState) {
  return state.status === "prefix" || state.status === "laying-out" || state.status === "failed"
}

function start(
  state: Extract<WordLayoutState, { status: "prefix" | "failed" }>,
  attempt: number,
  defer: boolean,
): WordLayoutTransition {
  return {
    state: { status: "laying-out", pages: state.pages, attempt },
    effects: [{ type: "start-step", attempt, defer, timeoutMs: WORD_LAYOUT_STEP_TIMEOUT_MS }],
  }
}

/**
 * The worker's region layout cursor. Only the prefix is laid out until the first step begins the region layout; a step
 * that throws returns the cursor to the prefix, so the next step begins it again instead of resuming a broken one.
 */
export type WorkerLayoutState =
  | { readonly status: "prefix" }
  /** `cost` is the running average milliseconds one body block takes. */
  | { readonly status: "stepping"; readonly cost: number }
  | { readonly status: "complete" }

export type WorkerLayoutEvent =
  /** A step laid out `blocks` body blocks in `elapsedMs`; the step that begins the layout reports no blocks. */
  | { readonly type: "step.progressed"; readonly elapsedMs: number; readonly blocks: number }
  | { readonly type: "step.completed" }
  | { readonly type: "step.failed" }

export function createWorkerLayoutState(provisional: boolean): WorkerLayoutState {
  return provisional ? { status: "prefix" } : { status: "complete" }
}

export function transitionWorkerLayout(state: WorkerLayoutState, event: WorkerLayoutEvent): WorkerLayoutState {
  if (state.status === "complete") return state

  if (event.type === "step.completed") return { status: "complete" }

  if (event.type === "step.failed") return state.status === "prefix" ? state : { status: "prefix" }

  // Blocks vary widely, and sizing a step by the last one alone overshoots after a run of cheap blocks.
  if (state.status === "stepping" && event.blocks > 0)
    return { status: "stepping", cost: state.cost * 0.7 + (event.elapsedMs / event.blocks) * 0.3 }

  return state.status === "stepping" ? state : { status: "stepping", cost: WORD_INITIAL_BLOCK_COST_MS }
}

/** How many body blocks the next step lays out to take about `WORD_STEP_BUDGET_MS`. */
export function stepBlocks(cost: number) {
  return Math.min(WORD_MAX_STEP_BLOCKS, Math.max(1, Math.round(WORD_STEP_BUDGET_MS / cost)))
}

/** Whether the whole document is laid out, so the engine can release built pages. */
export function workerLayoutComplete(state: WorkerLayoutState) {
  return state.status === "complete"
}

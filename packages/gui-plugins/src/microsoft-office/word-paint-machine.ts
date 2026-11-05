/** How long one page paint may take, its wait behind other pages included, before the page shows its notice. */
export const WORD_PAINT_TIMEOUT_MS = 30_000

/** One page's paint at one scale and pixel ratio. */
export type WordPageSlotState =
  | { readonly status: "painting"; readonly attempt: number; readonly scale: number; readonly ratio: number }
  | { readonly status: "painted"; readonly attempt: number }
  /** The page could not paint: its canvas is cleared and the page shows a notice with Try again at the same size. */
  | { readonly status: "failed"; readonly attempt: number; readonly scale: number; readonly ratio: number }

/** A document's page paints, by page index. Each paint takes the next attempt number; a page that left has no slot. */
export type WordPaintState =
  | { readonly status: "active"; readonly issued: number; readonly pages: ReadonlyMap<number, WordPageSlotState> }
  | { readonly status: "disposed" }

export type WordPaintEvent =
  /** The page column asked to paint a page at a new size; the slot takes `issued + 1` as its attempt. */
  | { readonly type: "paint.started"; readonly index: number; readonly scale: number; readonly ratio: number }
  /** Try again on a page that could not paint. */
  | { readonly type: "paint.retried"; readonly index: number }
  /** The page left, or a newer paint replaced this one. */
  | { readonly type: "paint.aborted"; readonly index: number; readonly attempt: number }
  | { readonly type: "paint.succeeded"; readonly index: number; readonly attempt: number; readonly bitmap: ImageBitmap }
  /** `quiet` when the call was replaced or withdrawn, or the worker stopped, which reports itself. */
  | { readonly type: "paint.failed"; readonly index: number; readonly attempt: number; readonly quiet: boolean }
  | { readonly type: "paint.timed-out"; readonly index: number; readonly attempt: number }
  | { readonly type: "disposed" }

export type WordPaintEffect =
  | {
      readonly type: "request-paint"
      readonly index: number
      readonly attempt: number
      readonly scale: number
      readonly ratio: number
      readonly timeoutMs: number
    }
  /** Withdraws the attempt's running call. */
  | { readonly type: "abort-paint"; readonly attempt: number }
  | { readonly type: "show-bitmap"; readonly index: number; readonly bitmap: ImageBitmap }
  /** Frees a bitmap that arrived for a paint nothing shows any more. */
  | { readonly type: "close-bitmap"; readonly bitmap: ImageBitmap }
  | { readonly type: "clear-canvas"; readonly index: number }

export type WordPaintTransition = { readonly state: WordPaintState; readonly effects: readonly WordPaintEffect[] }

/** A new document's paints; each document gets its own, as the state keeps a map. */
export function createWordPaintState(): WordPaintState {
  return { status: "active", issued: 0, pages: new Map() }
}

const DISPOSED: WordPaintState = Object.freeze({ status: "disposed" })

const NONE: readonly WordPaintEffect[] = []

export function transitionWordPaint(state: WordPaintState, event: WordPaintEvent): WordPaintTransition {
  if (state.status === "disposed")
    return {
      state,
      effects: event.type === "paint.succeeded" ? [{ type: "close-bitmap", bitmap: event.bitmap }] : NONE,
    }

  if (event.type === "disposed")
    return {
      state: DISPOSED,
      effects: [...state.pages.values()].flatMap((slot): WordPaintEffect[] =>
        slot.status === "painting" ? [{ type: "abort-paint", attempt: slot.attempt }] : [],
      ),
    }

  if (event.type === "paint.started") {
    const previous = state.pages.get(event.index)

    return paint(
      state,
      event.index,
      event.scale,
      event.ratio,
      previous?.status === "painting" ? [{ type: "abort-paint", attempt: previous.attempt }] : NONE,
    )
  }

  const slot = state.pages.get(event.index)

  if (event.type === "paint.retried")
    return slot?.status === "failed"
      ? paint(state, event.index, slot.scale, slot.ratio, NONE)
      : { state, effects: NONE }

  const current = slot && slot.attempt === event.attempt ? slot : undefined

  if (event.type === "paint.aborted") {
    if (!current) return { state, effects: NONE }

    return {
      state: { ...state, pages: withSlot(state.pages, event.index, undefined) },
      effects: current.status === "painting" ? [{ type: "abort-paint", attempt: current.attempt }] : NONE,
    }
  }

  if (event.type === "paint.succeeded") {
    // A bitmap for a page that left or painted again would hold its memory until collected.
    if (current?.status !== "painting") return { state, effects: [{ type: "close-bitmap", bitmap: event.bitmap }] }

    return {
      state: { ...state, pages: withSlot(state.pages, event.index, { status: "painted", attempt: current.attempt }) },
      effects: [{ type: "show-bitmap", index: event.index, bitmap: event.bitmap }],
    }
  }

  if (current?.status !== "painting") return { state, effects: NONE }

  // A replaced or withdrawn paint shows nothing, and the next paint asks again.
  if (event.type === "paint.failed" && event.quiet)
    return { state: { ...state, pages: withSlot(state.pages, event.index, undefined) }, effects: NONE }

  const failed: WordPageSlotState = {
    status: "failed",
    attempt: current.attempt,
    scale: current.scale,
    ratio: current.ratio,
  }

  return {
    state: { ...state, pages: withSlot(state.pages, event.index, failed) },
    effects: [
      ...(event.type === "paint.timed-out" ? [{ type: "abort-paint" as const, attempt: current.attempt }] : []),
      { type: "clear-canvas", index: event.index },
    ],
  }
}

/** The attempt of a page's paint, which its abort names. */
export function wordPaintAttempt(state: WordPaintState, index: number) {
  return state.status === "active" ? state.pages.get(index)?.attempt : undefined
}

/** Whether a page shows the notice that it could not paint. */
export function wordPaintFailed(state: WordPaintState, index: number) {
  return state.status === "active" && state.pages.get(index)?.status === "failed"
}

function paint(
  state: Extract<WordPaintState, { status: "active" }>,
  index: number,
  scale: number,
  ratio: number,
  aborts: readonly WordPaintEffect[],
): WordPaintTransition {
  const attempt = state.issued + 1

  return {
    state: {
      status: "active",
      issued: attempt,
      pages: withSlot(state.pages, index, { status: "painting", attempt, scale, ratio }),
    },
    effects: [...aborts, { type: "request-paint", index, attempt, scale, ratio, timeoutMs: WORD_PAINT_TIMEOUT_MS }],
  }
}

function withSlot(pages: ReadonlyMap<number, WordPageSlotState>, index: number, slot: WordPageSlotState | undefined) {
  const next = new Map(pages)

  if (!slot) {
    next.delete(index)

    return next
  }

  next.set(index, slot)

  return next
}

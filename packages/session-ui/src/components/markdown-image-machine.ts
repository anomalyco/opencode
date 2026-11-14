/** A read that has not settled after this long is aborted and retried, so a stalled request cannot hang the image. */
export const IMAGE_READ_TIMEOUT_MS = 15_000

/** The first retry waits this long; each later retry doubles it. */
export const IMAGE_RETRY_BASE_MS = 1_000

export const IMAGE_MAX_RETRIES = 3

/**
 * One local Markdown image path while it is in the container.
 * - `loading`: a read is in flight.
 * - `waiting`: a read failed or timed out and the next one is backing off.
 * - `loaded`: resolved to an image `src`; `revoke` marks a `blob:` URL the machine must release (an SVG `data:` URL
 *   needs no release).
 * - `failed`: the reader has nothing to show (`undefined`) or every retry failed; the image keeps its alt text.
 */
export type MarkdownImageEntry =
  | { readonly status: "loading"; readonly attempt: number; readonly failures: number }
  | { readonly status: "waiting"; readonly attempt: number; readonly failures: number }
  | { readonly status: "loaded"; readonly url: string; readonly revoke: boolean }
  | { readonly status: "failed" }

export type MarkdownImagesState =
  | {
      readonly status: "active"
      /** Last attempt id handed out. Each read and each backoff gets a new one, so late results are recognised. */
      readonly attempts: number
      readonly entries: ReadonlyMap<string, MarkdownImageEntry>
    }
  | { readonly status: "disposed" }

export type MarkdownImagesEvent =
  | { readonly type: "paths.synced"; readonly paths: ReadonlySet<string> }
  | {
      readonly type: "read.succeeded"
      readonly path: string
      readonly attempt: number
      readonly url: string
      readonly revoke: boolean
    }
  | { readonly type: "read.empty"; readonly path: string; readonly attempt: number }
  | { readonly type: "read.failed"; readonly path: string; readonly attempt: number }
  | { readonly type: "read.timed-out"; readonly path: string; readonly attempt: number }
  | { readonly type: "retry.due"; readonly path: string; readonly attempt: number }
  | { readonly type: "disposed" }

export type MarkdownImagesEffect =
  | { readonly type: "read"; readonly path: string; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "wait"; readonly path: string; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "cancel"; readonly attempt: number }
  | { readonly type: "revoke-url"; readonly url: string }

export type MarkdownImagesTransition = {
  readonly state: MarkdownImagesState
  readonly effects: readonly MarkdownImagesEffect[]
}

export const INITIAL_MARKDOWN_IMAGES_STATE: MarkdownImagesState = Object.freeze({
  status: "active",
  attempts: 0,
  entries: new Map(),
})

export const DISPOSED_MARKDOWN_IMAGES_STATE: MarkdownImagesState = Object.freeze({ status: "disposed" })

export const NO_MARKDOWN_IMAGE_EFFECTS: readonly MarkdownImagesEffect[] = Object.freeze([])

export function transitionMarkdownImages(
  state: MarkdownImagesState,
  event: MarkdownImagesEvent,
): MarkdownImagesTransition {
  if (state.status === "disposed") return ignore(state, event)

  if (event.type === "disposed")
    return { state: DISPOSED_MARKDOWN_IMAGES_STATE, effects: [...state.entries.values()].flatMap(release) }

  if (event.type === "paths.synced") return sync(state, event.paths)

  if (event.type === "retry.due") {
    const entry = state.entries.get(event.path)

    if (entry?.status !== "waiting" || entry.attempt !== event.attempt) return ignore(state, event)
    const attempt = state.attempts + 1

    return {
      state: withEntry(state, event.path, { status: "loading", attempt, failures: entry.failures }, attempt),
      effects: [
        { type: "cancel", attempt: entry.attempt },
        { type: "read", path: event.path, attempt, timeoutMs: IMAGE_READ_TIMEOUT_MS },
      ],
    }
  }

  const entry = state.entries.get(event.path)

  if (entry?.status !== "loading" || entry.attempt !== event.attempt) return ignore(state, event)
  const cancel = { type: "cancel", attempt: entry.attempt } as const

  if (event.type === "read.succeeded")
    return {
      state: withEntry(state, event.path, { status: "loaded", url: event.url, revoke: event.revoke }, state.attempts),
      effects: [cancel],
    }

  if (event.type === "read.empty" || entry.failures >= IMAGE_MAX_RETRIES)
    return { state: withEntry(state, event.path, { status: "failed" }, state.attempts), effects: [cancel] }
  const attempt = state.attempts + 1
  const failures = entry.failures + 1

  return {
    state: withEntry(state, event.path, { status: "waiting", attempt, failures }, attempt),
    effects: [cancel, { type: "wait", path: event.path, attempt, delayMs: IMAGE_RETRY_BASE_MS * 2 ** entry.failures }],
  }
}

export function selectMarkdownImageUrl(state: MarkdownImagesState, path: string) {
  if (state.status === "disposed") return
  const entry = state.entries.get(path)

  return entry?.status === "loaded" ? entry.url : undefined
}

function sync(
  state: Extract<MarkdownImagesState, { status: "active" }>,
  paths: ReadonlySet<string>,
): MarkdownImagesTransition {
  const removed = [...state.entries].filter(([path]) => !paths.has(path))
  const added = [...paths].filter((path) => path && !state.entries.has(path))

  if (removed.length === 0 && added.length === 0) return { state, effects: NO_MARKDOWN_IMAGE_EFFECTS }
  const entries = new Map(state.entries)
  removed.forEach(([path]) => entries.delete(path))

  const reads = added.map((path, index) => {
    const attempt = state.attempts + index + 1
    entries.set(path, { status: "loading", attempt, failures: 0 })

    return { type: "read", path, attempt, timeoutMs: IMAGE_READ_TIMEOUT_MS } as const
  })

  return {
    state: { status: "active", attempts: state.attempts + added.length, entries },
    effects: [...removed.flatMap(([, entry]) => release(entry)), ...reads],
  }
}

function release(entry: MarkdownImageEntry): MarkdownImagesEffect[] {
  if (entry.status === "loading" || entry.status === "waiting") return [{ type: "cancel", attempt: entry.attempt }]

  if (entry.status === "loaded" && entry.revoke) return [{ type: "revoke-url", url: entry.url }]

  return []
}

function withEntry(
  state: Extract<MarkdownImagesState, { status: "active" }>,
  path: string,
  entry: MarkdownImageEntry,
  attempts: number,
): MarkdownImagesState {
  return { status: "active", attempts, entries: new Map(state.entries).set(path, entry) }
}

// A reader that ignores its abort signal can still hand back a blob URL after the entry moved on; release it.
function ignore(state: MarkdownImagesState, event: MarkdownImagesEvent): MarkdownImagesTransition {
  if (event.type === "read.succeeded" && event.revoke)
    return { state, effects: [{ type: "revoke-url", url: event.url }] }

  return { state, effects: NO_MARKDOWN_IMAGE_EFFECTS }
}

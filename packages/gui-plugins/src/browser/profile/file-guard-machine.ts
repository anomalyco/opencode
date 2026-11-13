/**
 * When the profile's `file:` guard listens. Any `session.webRequest` listener makes Electron route the whole session
 * past the extensions' request proxy, so `chrome.webRequest` and `declarativeNetRequest` see nothing while it is on.
 * So it is on only while a `file:` document may load something, which is the one case Chromium does not already stop:
 * web, `blob:`, `data:` and extension documents cannot load `file:` URLs at all, and navigations to them are guarded
 * by the page.
 *
 * It fails closed. A `file:` navigation turns it on when it starts, before Chromium creates the loaders of the
 * navigation or of its document. It stays on while the navigation's page is loading, and while any frame lives in a
 * renderer process that committed a `file:` document: site isolation locks that process to `file:` pages and to
 * documents they open, so only such frames can ask for `file:` URLs. Unknown states keep it on.
 *
 * - `pending`: pages with a `file:` navigation started since they last stopped loading.
 * - `frames`: each live page's frames, by renderer process.
 * - `tainted`: renderer processes that committed a `file:` document.
 */
export type FileGuardState = {
  readonly on: boolean
  readonly pending: ReadonlySet<number>
  readonly frames: ReadonlyMap<number, readonly number[]>
  readonly tainted: ReadonlySet<number>
}

/**
 * - `navigation.started`: a frame of page `contents` started navigating to `url`.
 * - `frame.committed`: a frame committed `url` in renderer `process`.
 * - `loading.stopped`: page `contents` has no navigation in flight; `frames` are the processes of its frames now.
 * - `destroyed`: page `contents` is gone.
 */
export type FileGuardEvent =
  | { readonly type: "navigation.started"; readonly contents: number; readonly url: string }
  | { readonly type: "frame.committed"; readonly contents: number; readonly url: string; readonly process: number }
  | { readonly type: "loading.stopped"; readonly contents: number; readonly frames: readonly number[] }
  | { readonly type: "destroyed"; readonly contents: number }

export const initialFileGuard: FileGuardState = { on: false, pending: new Set(), frames: new Map(), tainted: new Set() }

export function transitionFileGuard(state: FileGuardState, event: FileGuardEvent): FileGuardState {
  const next = apply(state, event)

  if (next === state) return state

  const on =
    next.pending.size > 0 || [...next.frames.values()].some((frames) => frames.some((process) => next.tainted.has(process)))

  return { ...next, on }
}

function apply(state: FileGuardState, event: FileGuardEvent): FileGuardState {
  if (event.type === "navigation.started") {
    if (!fileURL(event.url) || state.pending.has(event.contents)) return state

    return { ...state, pending: new Set(state.pending).add(event.contents) }
  }

  if (event.type === "frame.committed") {
    const frames = state.frames.get(event.contents) ?? []
    const known = frames.includes(event.process) && (!fileURL(event.url) || state.tainted.has(event.process))

    if (known) return state

    return {
      ...state,
      frames: new Map(state.frames).set(event.contents, [...new Set([...frames, event.process])]),
      tainted: fileURL(event.url) ? new Set(state.tainted).add(event.process) : state.tainted,
    }
  }

  if (event.type === "loading.stopped") {
    const pending = new Set(state.pending)
    pending.delete(event.contents)

    return { ...state, pending, frames: new Map(state.frames).set(event.contents, event.frames) }
  }

  if (!state.pending.has(event.contents) && !state.frames.has(event.contents)) return state
  const pending = new Set(state.pending)
  const frames = new Map(state.frames)
  pending.delete(event.contents)
  frames.delete(event.contents)

  return { ...state, pending, frames }
}

function fileURL(url: string) {
  return url.trimStart().toLowerCase().startsWith("file:")
}

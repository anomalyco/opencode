import type { MountedSession } from "@opencode/plugin/gui"
import { SessionMedia } from "@opencode/schema/session-media"
import { createSignal, onCleanup } from "solid-js"

export type MediaItems = {
  readonly media: readonly SessionMedia.Media[]
  readonly links: readonly SessionMedia.Link[]
}

export type MediaHistory = {
  /** Every item read so far, newest first. Reactive. */
  readonly items: () => MediaItems
  /**
   * Nothing read yet, older history being read, older history left to read, all read, or the last read failed. A
   * refresh of the newest messages keeps the status it had. Reactive.
   */
  readonly status: () => "empty" | "loading" | "more" | "done" | "failed"
  /** Counts settled reads, so a caller paging while the list's end shows tries again after each one. Reactive. */
  readonly settled: () => number
  /** Reads the newest messages again, keeping what older pages found. */
  readonly refresh: () => void
  /** Reads the next page of older messages, unless a read is in flight or none remain. */
  readonly older: () => void
  /** Repeats the read that failed. */
  readonly retry: () => void
}

// The first read fills a screen; later reads of the newest messages only cover what arrived since.
const FIRST = 200

const RECENT = 50

const OLDER = 200

type State = MediaItems & {
  /** Creation time of the newest message read. */
  readonly newest?: number
  /** Where older history continues, while it does. */
  readonly next?: string
}

/**
 * A session's media, read from the server's `experimental.media` RPC a page at a time, newest first, so the panel lists the
 * whole session without the timeline loading its messages. One read runs at a time; a refresh asked for meanwhile runs
 * after it.
 */
export function createMediaHistory(session: MountedSession): MediaHistory {
  const controller = new AbortController()
  const [state, setState] = createSignal<State>()
  const [busy, setBusy] = createSignal<"refresh" | "older">()
  const [failed, setFailed] = createSignal<"refresh" | "older">()
  const [settled, setSettled] = createSignal(0)
  let stale = false

  onCleanup(() => controller.abort())

  const list = (input: { cursor?: string; limit: number }) =>
    session.server.client
      .rpc(SessionMedia.Definition)
      .list(
        { sessionID: session.id, ...input },
        { location: { directory: session.directory }, signal: controller.signal },
      )

  const run = (kind: "refresh" | "older", read: () => Promise<State>) => {
    setBusy(kind)
    setFailed(undefined)
    void read().then(
      (next) => {
        setState(next)
        settle()
      },
      () => {
        if (controller.signal.aborted) return
        setFailed(kind)
        settle()
      },
    )
  }

  const settle = () => {
    setBusy(undefined)
    setSettled((count) => count + 1)

    if (!stale) return
    stale = false
    refresh()
  }

  const refresh = () => {
    if (busy()) return void (stale = true)
    const current = state()

    run("refresh", () => list({ limit: current ? RECENT : FIRST }).then((page) => merge(current, page)))
  }

  const older = () => {
    const current = state()
    const cursor = current?.next

    if (busy() || !current || !cursor) return
    run("older", () =>
      list({ cursor, limit: OLDER }).then((page) => ({
        ...current,
        media: combine([...current.media, ...page.media]),
        links: combine([...current.links, ...page.links], title),
        next: page.next,
      })),
    )
  }

  return {
    items: () => state() ?? { media: [], links: [] },
    status: () => {
      if (failed()) return "failed"

      if (busy() === "older") return "loading"
      const current = state()

      if (!current) return "empty"

      return current.next ? "more" : "done"
    },
    settled,
    refresh,
    older,
    retry: () => (failed() === "older" ? older() : refresh()),
  }
}

/**
 * The newest page over what was read before. Older items stay when the page reaches back to the newest message read
 * before; past that, or when the page reads the whole session, it replaces them. Items of messages the page read come
 * from the page alone, so a reverted message's items go.
 */
function merge(current: State | undefined, page: SessionMedia.Page): State {
  const fresh = { media: page.media, links: page.links, newest: page.newest, next: page.next }
  const oldest = page.oldest

  if (!current || !page.next || oldest === undefined || current.newest === undefined || current.newest < oldest)
    return fresh

  return {
    media: combine([...page.media, ...current.media.filter((item) => item.time <= oldest)]),
    links: combine([...page.links, ...current.links.filter((item) => item.time <= oldest)], title),
    newest: page.newest,
    next: current.next,
  }
}

// One item per key (or id), the first and so the newest; `fill` lets it take what a later duplicate adds.
function combine<T extends { readonly id: string; readonly key?: string }>(
  items: readonly T[],
  fill: (kept: T, item: T) => T = (kept) => kept,
) {
  const kept = items.reduce((result, item) => {
    const key = item.key ?? item.id
    const existing = result.get(key)

    return result.set(key, existing ? fill(existing, item) : item)
  }, new Map<string, T>())

  return [...kept.values()]
}

const title = (kept: SessionMedia.Link, item: SessionMedia.Link) =>
  kept.title || !item.title ? kept : { ...kept, title: item.title }

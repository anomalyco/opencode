import { describe, expect, test } from "bun:test"
import {
  LINK_OPEN_TIMEOUT_MS,
  initialLinkOpenState,
  transitionLinkOpen,
  type LinkOpenEvent,
  type LinkOpenState,
  type LinkOpenTransition,
  type LinkRoute,
} from "./link-open-machine"

const here: LinkRoute = { sessionKey: "s1", root: "/repo/main", sameScreen: true }

const click: LinkOpenEvent = {
  type: "link.clicked",
  sessionKey: "s1",
  root: "/repo/main",
  href: "shopping.txt",
  background: false,
}

const resolvedFile = (attempt: number, route = here): LinkOpenEvent => ({
  type: "link.resolved",
  attempt,
  route,
  resolution: { kind: "file", path: "shopping.txt" },
})

const synced = (attempt: number, fields: Partial<Extract<LinkOpenEvent, { type: "file.synced" }>>): LinkOpenEvent => ({
  type: "file.synced",
  attempt,
  route: here,
  loaded: false,
  notFound: false,
  opened: false,
  ...fields,
})

// Folds the events in order and returns the last transition.
const replay = (events: readonly LinkOpenEvent[], state: LinkOpenState = initialLinkOpenState) =>
  events.reduce<LinkOpenTransition>((last, event) => transitionLinkOpen(last.state, event), { state, effects: [] })

describe("transitionLinkOpen", () => {
  test("a file that does not load after the forced reread reports the failure instead of doing nothing", () => {
    const result = replay([
      click,
      resolvedFile(1),
      synced(1, { notFound: true, error: "File not found: shopping.txt" }),
    ])

    expect(result.state).toEqual({ status: "idle", issued: 1 })
    expect(result.effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "toast-failed", path: "shopping.txt", error: "File not found: shopping.txt" },
    ])
  })

  test("a deleted file whose tab is already in the strip selects that tab, which shows the not-found state", () => {
    const result = replay([click, resolvedFile(1), synced(1, { notFound: true, opened: true, error: "gone" })])

    expect(result.effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "open-file", path: "shopping.txt", selection: undefined, background: false },
    ])
  })

  test("a file the model never populated still reports a failure", () => {
    expect(replay([click, resolvedFile(1), synced(1, {})]).effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "toast-failed", path: "shopping.txt", error: undefined },
    ])
  })

  test("a loaded file opens with its selection, and a failed reread of it shows the error too", () => {
    const selection = { start: 3, end: 5 }

    const resolving = replay([
      { ...click, background: true },
      { type: "link.resolved", attempt: 1, route: here, resolution: { kind: "file", path: "a.ts", selection } },
    ])

    expect(resolving.effects).toEqual([{ type: "sync", attempt: 1, path: "a.ts" }])
    expect(transitionLinkOpen(resolving.state, synced(1, { loaded: true })).effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "open-file", path: "a.ts", selection, background: true },
    ])
    expect(transitionLinkOpen(resolving.state, synced(1, { loaded: true, error: "read failed" })).effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "open-file", path: "a.ts", selection, background: true },
      { type: "toast-failed", path: "a.ts", error: "read failed" },
    ])
  })

  test("a click claims an attempt and starts resolving before any await", () => {
    expect(transitionLinkOpen(initialLinkOpenState, { ...click, base: "docs" })).toEqual({
      state: {
        status: "resolving",
        attempt: 1,
        sessionKey: "s1",
        root: "/repo/main",
        href: "shopping.txt",
        background: false,
      },
      effects: [
        {
          type: "resolve",
          attempt: 1,
          href: "shopping.txt",
          base: "docs",
          background: false,
          timeoutMs: LINK_OPEN_TIMEOUT_MS,
        },
      ],
    })
  })

  test("an exact link supersedes the click in flight, whose late results change nothing", () => {
    const exact = replay([click, { type: "link.exact", href: "b.ts", path: "b.ts", background: false }])

    expect(exact.state).toEqual({ status: "idle", issued: 2 })
    expect(exact.effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "open-exact", path: "b.ts", background: false },
    ])

    const late = transitionLinkOpen(exact.state, resolvedFile(1))

    expect(late.state).toBe(exact.state)
    expect(late.effects).toEqual([])
    expect(transitionLinkOpen(exact.state, synced(1, { loaded: true })).state).toBe(exact.state)
  })

  test("a newer click supersedes the older one", () => {
    const second = replay([click, { ...click, href: "b.ts" }])

    expect(second.effects[0]).toEqual({ type: "abort", attempt: 1 })
    expect(second.state).toMatchObject({ status: "resolving", attempt: 2, href: "b.ts" })
    expect(transitionLinkOpen(second.state, resolvedFile(1)).state).toBe(second.state)
  })

  test("a session directory move while resolving or loading drops the result without opening or a toast", () => {
    const moved = { ...here, root: "/repo/wt" }

    expect(replay([click, resolvedFile(1, moved)])).toEqual({
      state: { status: "idle", issued: 1 },
      effects: [{ type: "abort", attempt: 1 }],
    })
    expect(replay([click, resolvedFile(1), synced(1, { loaded: true, route: moved })]).effects).toEqual([
      { type: "abort", attempt: 1 },
    ])
  })

  test("another session or screen drops the result", () => {
    expect(replay([click, resolvedFile(1, { ...here, sessionKey: "s2" })]).effects).toEqual([
      { type: "abort", attempt: 1 },
    ])
    expect(replay([click, resolvedFile(1, { ...here, sameScreen: false })]).effects).toEqual([
      { type: "abort", attempt: 1 },
    ])
  })

  test("a link that resolves to no path reports the failure", () => {
    expect(replay([{ type: "link.exact", href: "/", path: "", background: false }]).effects).toEqual([
      { type: "toast-failed", path: "/" },
    ])
    expect(
      replay([click, { type: "link.resolved", attempt: 1, route: here, resolution: { kind: "missing" } }]).effects,
    ).toEqual([
      { type: "abort", attempt: 1 },
      { type: "toast-failed", path: "shopping.txt" },
    ])
  })

  test("several matches open the picker and loadable HTML opens in the browser pane", () => {
    expect(
      replay([click, { type: "link.resolved", attempt: 1, route: here, resolution: { kind: "picker", query: "a.ts" } }])
        .effects,
    ).toEqual([
      { type: "abort", attempt: 1 },
      { type: "open-picker", query: "a.ts", background: false },
    ])
    expect(
      replay([
        click,
        { type: "link.resolved", attempt: 1, route: here, resolution: { kind: "browser", url: "file:///a.html" } },
      ]).effects,
    ).toEqual([
      { type: "abort", attempt: 1 },
      { type: "open-browser", url: "file:///a.html" },
    ])
  })

  test("a rejected import, search or reread reports its error only where the user still is", () => {
    const failed: LinkOpenEvent = { type: "link.failed", attempt: 1, route: here, error: "network" }

    expect(replay([click, failed]).effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "toast-failed", path: "shopping.txt", error: "network" },
    ])
    expect(replay([click, resolvedFile(1), failed]).effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "toast-failed", path: "shopping.txt", error: "network" },
    ])
    expect(replay([click, { ...failed, route: { ...here, sessionKey: "s2" } }]).effects).toEqual([
      { type: "abort", attempt: 1 },
    ])
  })

  test("a hung click times out in either phase and ignores its late results", () => {
    const resolving = replay([click, { type: "link.timed-out", attempt: 1 }])

    expect(resolving.state).toEqual({ status: "idle", issued: 1 })
    expect(resolving.effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "toast-timeout", path: "shopping.txt" },
    ])
    expect(transitionLinkOpen(resolving.state, resolvedFile(1)).state).toBe(resolving.state)

    const loading = replay([click, resolvedFile(1), { type: "link.timed-out", attempt: 1 }])

    expect(loading.effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "toast-timeout", path: "shopping.txt" },
    ])
    expect(transitionLinkOpen(loading.state, synced(1, { loaded: true })).state).toBe(loading.state)
  })

  test("a cancelled click ends quietly, and a stale cancel or timeout changes nothing", () => {
    expect(replay([click, { type: "link.cancelled", attempt: 1 }])).toEqual({
      state: { status: "idle", issued: 1 },
      effects: [{ type: "abort", attempt: 1 }],
    })

    const second = replay([click, { ...click, href: "b.ts" }])

    expect(transitionLinkOpen(second.state, { type: "link.timed-out", attempt: 1 }).state).toBe(second.state)
    expect(transitionLinkOpen(second.state, { type: "link.cancelled", attempt: 1 }).state).toBe(second.state)
  })

  test("results out of phase change nothing", () => {
    const resolving = replay([click])

    expect(transitionLinkOpen(resolving.state, synced(1, { loaded: true })).state).toBe(resolving.state)

    const loading = replay([click, resolvedFile(1)])

    expect(transitionLinkOpen(loading.state, resolvedFile(1)).state).toBe(loading.state)
    expect(transitionLinkOpen(initialLinkOpenState, resolvedFile(0)).state).toBe(initialLinkOpenState)
  })

  test("disposal aborts the click in flight and ignores everything after it", () => {
    const disposed = replay([click, { type: "disposed" }])

    expect(disposed).toEqual({ state: { status: "disposed" }, effects: [{ type: "abort", attempt: 1 }] })
    expect(transitionLinkOpen(disposed.state, click).state).toBe(disposed.state)
    expect(transitionLinkOpen(disposed.state, resolvedFile(1)).effects).toEqual([])
    expect(transitionLinkOpen(initialLinkOpenState, { type: "disposed" }).effects).toEqual([])
  })
})

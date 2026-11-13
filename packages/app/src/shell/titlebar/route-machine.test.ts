import { describe, expect, test } from "bun:test"
import { ServerKey } from "@/runtime/server/persistence"
import { tabKey, type SessionTab } from "@/shell/tabs/tabs"
import {
  cachedRootID,
  INITIAL_ROUTE_TAB_STATE,
  transitionRouteTab,
  type RouteSession,
  type RouteTabEvent,
  type RouteTabSnapshot,
  type RouteTabState,
} from "./route-machine"

const server = ServerKey.make("server")

const rootTab: SessionTab = { type: "session", server, sessionId: "ses_root" }

// Without a server the lookup holds, so a snapshot exercises only the tab strip unless it says otherwise.
function snapshot(sessionID: string, input: Partial<RouteTabSnapshot> = {}): RouteTabSnapshot {
  return {
    route: { type: "session", server, sessionId: sessionID },
    ready: true,
    tab: undefined,
    preview: undefined,
    recentKey: undefined,
    pending: false,
    session: undefined,
    rootID: undefined,
    serverReady: false,
    ...input,
  }
}

function sync(input: RouteTabSnapshot): RouteTabEvent {
  return { type: "sync", snapshot: input }
}

function replay(events: RouteTabEvent[], state: RouteTabState = INITIAL_ROUTE_TAB_STATE) {
  return events.reduce<{ state: RouteTabState; effects: unknown[][] }>(
    (acc, event) => {
      const result = transitionRouteTab(acc.state, event)

      return { state: result.state, effects: [...acc.effects, [...result.effects]] }
    },
    { state, effects: [] },
  )
}

const remembered = { tab: rootTab, recentKey: tabKey(rootTab) }

const child = { server, sessionID: "ses_child" }

describe("route tab sync", () => {
  test("a tab that closes under its route without navigating is not added again until the route changes", () => {
    const result = replay([
      sync(snapshot("ses_root", { ...remembered, rootID: "ses_root" })),
      sync(snapshot("ses_root", { rootID: "ses_root" })),
      sync(snapshot("ses_root", { rootID: "ses_root" })),
      sync(snapshot("ses_other", { rootID: "ses_other" })),
      sync(snapshot("ses_root", { rootID: "ses_root" })),
    ])

    expect(result.effects).toEqual([
      [],
      [],
      [],
      [{ type: "tab.add", server, sessionID: "ses_other" }],
      [{ type: "tab.add", server, sessionID: "ses_root" }],
    ])
  })

  test("a closed route takes its tab again when the user reopens it, but not when its lookup resolves", () => {
    const closed = replay([
      sync(snapshot("ses_root", { ...remembered, serverReady: true })),
      sync(snapshot("ses_root", { serverReady: true })),
    ])

    expect(closed.state).toMatchObject({ tab: "closed", lookup: "resolving" })
    expect(
      transitionRouteTab(closed.state, {
        type: "resolve.succeeded",
        attempt: 1,
        target: { server, sessionID: "ses_root" },
        rootID: "ses_root",
      }).effects,
    ).toEqual([])
    expect(transitionRouteTab(closed.state, sync(snapshot("ses_root", remembered))).state).toMatchObject({
      tab: "shown",
    })
  })

  test("a child whose root cannot be fetched gets no tab of its own", () => {
    const session = { id: "ses_child", parentID: "ses_parent" }

    const result = replay([
      sync(snapshot("ses_child", { session, serverReady: true })),
      { type: "resolve.failed", attempt: 1, target: child },
      sync(snapshot("ses_child", { session, serverReady: true })),
    ])

    expect(result.effects).toEqual([[{ type: "session.resolve", attempt: 1, target: child }], [], []])
    expect(result.state).toMatchObject({ tab: "missing", lookup: "failed" })
  })

  test("a resolved child opens its root's tab", () => {
    const result = replay([
      sync(snapshot("ses_child", { session: { id: "ses_child", parentID: "ses_root" }, serverReady: true })),
      { type: "resolve.succeeded", attempt: 1, target: child, rootID: "ses_root" },
    ])

    expect(result.effects.at(-1)).toEqual([{ type: "tab.add", server, sessionID: "ses_root" }])
    expect(result.state).toMatchObject({ tab: "adding", lookup: "resolved" })
  })

  test("a routed session with a tab is still refreshed once", () => {
    const result = replay([
      sync(snapshot("ses_child", { ...remembered, serverReady: true })),
      sync(snapshot("ses_child", { ...remembered, serverReady: true })),
      { type: "resolve.succeeded", attempt: 1, target: child, rootID: "ses_root" },
      sync(snapshot("ses_child", { ...remembered, serverReady: true })),
    ])

    expect(result.effects).toEqual([[{ type: "session.resolve", attempt: 1, target: child }], [], [], []])
  })

  test("leaving a route aborts its lookup and ignores the late result", () => {
    const result = replay([
      sync(snapshot("ses_first", { serverReady: true })),
      sync(snapshot("ses_second", { serverReady: true })),
      { type: "resolve.succeeded", attempt: 1, target: { server, sessionID: "ses_first" }, rootID: "ses_first" },
    ])

    expect(result.effects).toEqual([
      [{ type: "session.resolve", attempt: 1, target: { server, sessionID: "ses_first" } }],
      [
        { type: "attempt.abort", attempt: 1 },
        { type: "session.resolve", attempt: 2, target: { server, sessionID: "ses_second" } },
      ],
      [],
    ])
  })

  test("a lookup waits for the server, then starts once", () => {
    const result = replay([
      sync(snapshot("ses_child")),
      sync(snapshot("ses_child")),
      sync(snapshot("ses_child", { serverReady: true })),
      sync(snapshot("ses_child", { serverReady: true })),
    ])

    expect(result.effects).toEqual([[], [], [{ type: "session.resolve", attempt: 1, target: child }], []])
  })

  test("a pending session adds its own tab once and is looked up only after its promotion settles", () => {
    const result = replay([
      sync(snapshot("ses_pending", { pending: true, rootID: "ses_pending", serverReady: true })),
      sync(snapshot("ses_pending", { pending: true, rootID: "ses_pending", serverReady: true })),
      sync(snapshot("ses_pending", { tab: { ...rootTab, sessionId: "ses_pending" }, serverReady: true })),
    ])

    expect(result.effects).toEqual([
      [{ type: "tab.add", server, sessionID: "ses_pending" }],
      [],
      [
        { type: "session.resolve", attempt: 1, target: { server, sessionID: "ses_pending" } },
        { type: "tab.remember", tab: { ...rootTab, sessionId: "ses_pending" } },
      ],
    ])
  })

  test("a child route is recorded on its root tab only once the child's parent is known", () => {
    const session: RouteSession = { id: "ses_child", parentID: "ses_parent" }
    const routed = { ...rootTab, routeSessionId: "ses_child", routeParentId: "ses_parent" }

    const result = replay([
      sync(snapshot("ses_child", remembered)),
      sync(snapshot("ses_child", { ...remembered, session })),
    ])

    expect(result.effects).toEqual([
      [],
      [{ type: "tab.route", tab: rootTab, sessionID: "ses_child", parentID: "ses_parent" }],
    ])

    const settled = transitionRouteTab(
      result.state,
      sync(snapshot("ses_child", { tab: routed, recentKey: tabKey(rootTab), session })),
    )

    expect(settled.state).toBe(result.state)
    expect(settled.effects).toEqual([])
  })

  test("a preview is never remembered, and remembering a pinned tab ends an open preview", () => {
    const preview = { ...rootTab, sessionId: "ses_preview" }

    expect(
      transitionRouteTab(INITIAL_ROUTE_TAB_STATE, sync(snapshot("ses_preview", { tab: preview, preview }))).effects,
    ).toEqual([])
    expect(transitionRouteTab(INITIAL_ROUTE_TAB_STATE, sync(snapshot("ses_root", remembered))).effects).toEqual([])
    expect(
      transitionRouteTab(INITIAL_ROUTE_TAB_STATE, sync(snapshot("ses_root", { ...remembered, preview }))).effects,
    ).toEqual([{ type: "tab.remember", tab: rootTab }])
  })

  test("a draft route remembers its draft tab", () => {
    const draft = { type: "draft" as const, draftID: "draft", server, directory: "/project" }

    const result = transitionRouteTab(
      INITIAL_ROUTE_TAB_STATE,
      sync({ ...snapshot("unused", { tab: draft }), route: { type: "draft", draftID: "draft" } }),
    )

    expect(result.state).toBe(INITIAL_ROUTE_TAB_STATE)
    expect(result.effects).toEqual([{ type: "tab.remember", tab: draft }])
  })

  test("nothing happens before the tabs load", () => {
    expect(transitionRouteTab(INITIAL_ROUTE_TAB_STATE, sync(snapshot("ses_root", { ready: false })))).toEqual({
      state: INITIAL_ROUTE_TAB_STATE,
      effects: [],
    })
  })

  test("disposing aborts the lookup and ignores later events", () => {
    const result = replay([
      sync(snapshot("ses_child", { serverReady: true })),
      { type: "dispose" },
      { type: "resolve.succeeded", attempt: 1, target: child, rootID: "ses_root" },
      sync(snapshot("ses_root", { rootID: "ses_root" })),
    ])

    expect(result.effects.slice(1)).toEqual([[{ type: "attempt.abort", attempt: 1 }], [], []])
    expect(result.state).toEqual({ status: "disposed" })
  })
})

describe("cached root", () => {
  const sessions = new Map<string, RouteSession>(
    [
      { id: "ses_root" },
      { id: "ses_child", parentID: "ses_root" },
      { id: "ses_grandchild", parentID: "ses_child" },
      { id: "ses_orphan", parentID: "ses_missing" },
      { id: "ses_a", parentID: "ses_b" },
      { id: "ses_b", parentID: "ses_a" },
    ].map((session) => [session.id, session]),
  )

  test.each([
    { sessionID: "ses_grandchild", root: "ses_root" },
    { sessionID: "ses_root", root: "ses_root" },
    { sessionID: "ses_orphan", root: undefined },
    { sessionID: "ses_a", root: undefined },
    { sessionID: "ses_unknown", root: undefined },
  ])("$sessionID resolves to $root", ({ sessionID, root }) => {
    expect(cachedRootID(sessionID, (id) => sessions.get(id))).toBe(root)
  })
})

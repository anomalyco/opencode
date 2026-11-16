import { expect, test } from "bun:test"
import type { OpenCodeEvent, SessionInfo } from "@opencode/client/promise"
import { resolveServerList, ServerConnection } from "@/runtime/server/registry"
import {
  addPin,
  dedupePins,
  INITIAL_RECENT_PAGE_STATE,
  RECENT_PAGE_TIMEOUT_MS,
  RECENT_PAGE_LIMIT,
  RECENT_VISIBLE_LIMIT,
  RECENT_WINDOW_MS,
  mergeRecentSessions,
  partitionRecentSessions,
  recentPageHasMore,
  recentPageLoadingMore,
  recentReloadsOn,
  recentSessionEndpoints,
  recentSessionKey,
  recentRowUnread,
  removePin,
  reorderPins,
  sortRecentSessions,
  transitionRecentPage,
  splitRecentSessionKey,
  windowRecentSessions,
  type RecentSession,
} from "./recent-sessions-model"

const session = (id: string, updated: number, extra: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated },
  title: id,
  location: { directory: "/project" },
  ...extra,
})

const item = (server: string, value: SessionInfo): RecentSession => ({
  key: recentSessionKey(server, value.id),
  server,
  session: value,
})

test("hiding filters hydrated pins and recent rows only on their server", () => {
  const pin = item("local", session("pinned", 1))
  const recent = item("local", session("recent", 2))
  const remote = item("remote", recent.session)

  const input = {
    items: [recent, remote],
    pins: [pin.key],
    endpoints: new Map<string, string>(),
    open: new Set<string>(),
    archived: () => false,
    resolvePin: () => pin,
  }

  expect(partitionRecentSessions({ ...input, hidden: (server) => server === "local" })).toEqual({
    pinned: [],
    recent: [remote],
  })
  expect(partitionRecentSessions(input).pinned).toEqual([pin])
})

test("muting hides the unread dot until unmuted", () => {
  expect(recentRowUnread(true, false, true)).toBe(false)
  expect(recentRowUnread(true, false, false)).toBe(true)
  expect(recentRowUnread(true, true, false)).toBe(false)
})

test("pin keys round trip server keys that contain the separator's neighbours", () => {
  const key = recentSessionKey("http://server.example:4096", "ses_1")

  expect(splitRecentSessionKey(key)).toEqual({ server: "http://server.example:4096", sessionID: "ses_1" })
  expect(splitRecentSessionKey("ses_1")).toBeUndefined()
})

test("pinning appends once and unpinning keeps the other order", () => {
  const pins = addPin(addPin([], "a"), "b")

  expect(pins).toEqual(["a", "b"])
  expect(addPin(pins, "a")).toEqual(["a", "b"])
  expect(removePin(pins, "a", new Map())).toEqual(["b"])
  expect(removePin(pins, "missing", new Map())).toEqual(["a", "b"])
})

test("dedupe keeps the first occurrence and drops keys without a session", () => {
  const a = recentSessionKey("server", "ses_a")
  const b = recentSessionKey("server", "ses_b")

  expect(dedupePins([a, b, a, "", "\u0000", "server\u0000", b])).toEqual([a, b])
})

test("reordering visible pins keeps hidden pins in their slots", () => {
  expect(reorderPins(["a", "hidden", "b", "c"], ["a", "b", "c"], ["c", "a", "b"])).toEqual([
    "c",
    "hidden",
    "a",
    "b",
  ])
})

test("reordering rejects a different visible set", () => {
  expect(reorderPins(["a", "b"], ["a", "b"], ["a", "c"])).toEqual(["a", "b"])
  expect(reorderPins(["a", "b"], ["a", "b"], ["a"])).toEqual(["a", "b"])
  expect(reorderPins(["a", "b"], ["a", "b"], ["a", "a"])).toEqual(["a", "b"])
})

test("merging prefers the live store and keeps root, unarchived sessions", () => {
  const child = session("ses_child", 40, { parentID: "ses_parent" })
  const archived = session("ses_archived", 30, { time: { created: 1, updated: 30, archived: 30 } })

  expect(
    mergeRecentSessions(
      "server",
      [session("ses_a", 10), child, archived],
      [session("ses_a", 20, { title: "loaded" }), session("ses_live", 5)],
    ),
  ).toEqual([
    item("server", session("ses_a", 10, { title: "loaded" })),
    item("server", session("ses_live", 5)),
  ])
})

// Like the iOS app, only a reload of the list or the user's own send moves a row.
test.each([
  ["a rename", session("ses_b", 30, { title: "Renamed" })],
  ["a model selection", session("ses_b", 30, { model: { providerID: "provider", id: "other" } })],
  ["an agent selection", session("ses_b", 30, { agent: "plan" })],
  ["a step", session("ses_b", 30, { time: { created: 1, updated: 30, busy: 30 } })],
  ["a run end", session("ses_b", 30, { time: { created: 1, updated: 30, idle: 30 } })],
])("%s does not move a row until the next reload, which re-sorts it", (_, live) => {
  const order = (fetched: readonly SessionInfo[]) =>
    mergeRecentSessions("server", fetched, [live]).map((entry) => entry.session.id)

  const snapshot = readyPage([session("ses_a", 20), session("ses_b", 10)])
  expect(order(snapshot.sessions)).toEqual(["ses_a", "ses_b"])
  expect(mergeRecentSessions("server", snapshot.sessions, [live])[1]?.session).toEqual({
    ...live,
    time: { ...live.time, updated: 10 },
  })

  const started = transitionRecentPage(snapshot, { type: "reload", attempt: 1 })

  const reloaded = transitionRecentPage(started.state, {
    type: "succeeded",
    attempt: 1,
    sessions: [session("ses_b", 30), session("ses_a", 20)],
    next: undefined,
  })

  expect(order(reloaded.state.sessions)).toEqual(["ses_b", "ses_a"])
})

test("a session created since the last reload ranks by its live time, an older one outside the pages never above them", () => {
  // Another client renamed an old session, and the live store loaded it with the rename time.
  const renamed = session("ses_renamed", 300, { time: { created: 5, updated: 300 } })
  const created = session("ses_created", 200, { time: { created: 200, updated: 200 } })

  const merged = mergeRecentSessions("server", [session("ses_a", 100), session("ses_b", 90)], [renamed, created])

  expect(merged.map((entry) => [entry.session.id, entry.session.time.updated])).toEqual([
    ["ses_created", 200],
    ["ses_a", 100],
    ["ses_b", 90],
    ["ses_renamed", 90],
  ])
})

test("sessions with equal timestamps order by id, and missing updates fall back to creation", () => {
  // SAFETY: a page read before `time.updated` existed can omit it; the sorter falls back to `time.created`.
  const withoutUpdate = { ...session("ses_old", 0), time: { created: 5 } } as SessionInfo

  expect(
    sortRecentSessions([
      item("server", session("ses_b", 10)),
      item("server", withoutUpdate),
      item("server", session("ses_a", 10)),
    ]).map((entry) => entry.session.id),
  ).toEqual(["ses_a", "ses_b", "ses_old"])
})

test("pins keep their order, leave Recent, and hide archived sessions without dropping the key", () => {
  const a = item("server", session("ses_a", 10))
  const b = item("server", session("ses_b", 20))
  const c = item("server", session("ses_c", 30))
  const archived = new Set([recentSessionKey("server", "ses_b")])

  const result = partitionRecentSessions({
    items: [a, b, c],
    endpoints: new Map(),
    open: new Set(),
    pins: [b.key, a.key],
    resolvePin: () => undefined,
    archived: (key) => archived.has(key),
  })

  expect(result.pinned).toEqual([a])
  expect(result.recent).toEqual([c])
})

const now = 1_000 * RECENT_WINDOW_MS

const hour = 60 * 60 * 1000

// Newest first, one hour apart, ending `older` rows past the 7-day cutoff.
const timeline = (recent: number, older: number) =>
  sortRecentSessions([
    ...Array.from({ length: recent }, (_, index) => item("server", session(`ses_r${index}`, now - index * hour))),
    ...Array.from({ length: older }, (_, index) =>
      item("server", session(`ses_o${index}`, now - RECENT_WINDOW_MS - (index + 1) * hour)),
    ),
  ])

const ids = (rows: readonly RecentSession[]) => rows.map((row) => row.session.id)

test("Recent shows only the last 7 days, newest first", () => {
  const items = timeline(3, 4)
  const result = windowRecentSessions({ items, now, revealed: 0, serversHaveMore: false })

  expect(ids(result.visible)).toEqual(["ses_r0", "ses_r1", "ses_r2"])
  expect(result.hasMore).toBe(true)

  // The window moves with time: the oldest recent row ages out once it is more than 7 days old.
  const later = windowRecentSessions({
    items,
    now: now + RECENT_WINDOW_MS - 2 * hour + 1,
    revealed: 0,
    serversHaveMore: false,
  })

  expect(ids(later.visible)).toEqual(["ses_r0", "ses_r1"])
})

test("Recent caps the last 7 days at 30 rows", () => {
  const result = windowRecentSessions({ items: timeline(45, 0), now, revealed: 0, serversHaveMore: false })

  expect(result.visible).toHaveLength(RECENT_VISIBLE_LIMIT)
  expect(result.visible.at(-1)?.session.id).toBe("ses_r29")
  expect(result.hasMore).toBe(true)
})

test("Show more reveals 30 more rows regardless of age", () => {
  const items = timeline(5, 40)
  const result = windowRecentSessions({ items, now, revealed: RECENT_VISIBLE_LIMIT, serversHaveMore: false })

  expect(result.visible).toHaveLength(5 + RECENT_VISIBLE_LIMIT)
  expect(result.visible.at(-1)?.session.id).toBe("ses_o29")
  expect(result.hasMore).toBe(true)

  const all = windowRecentSessions({ items, now, revealed: 2 * RECENT_VISIBLE_LIMIT, serversHaveMore: false })
  expect(all.visible).toHaveLength(45)
  expect(all.hasMore).toBe(false)
  // More rows than are loaded tells the driver to fetch further pages.
  expect(all.limit).toBe(65)
})

test("Show more stays while a server still has pages, even when every loaded row shows", () => {
  const items = timeline(10, 0)

  expect(windowRecentSessions({ items, now, revealed: 0, serversHaveMore: false }).hasMore).toBe(false)
  expect(windowRecentSessions({ items, now, revealed: 0, serversHaveMore: true }).hasMore).toBe(true)
})

test("pinned sessions do not count toward the Recent limit", () => {
  const items = timeline(40, 0)
  const pins = items.slice(0, 5).map((entry) => entry.key)

  const partition = partitionRecentSessions({
    items,
    endpoints: new Map(),
    open: new Set(),
    pins,
    resolvePin: () => undefined,
    archived: () => false,
  })

  const result = windowRecentSessions({ items: partition.recent, now, revealed: 0, serversHaveMore: false })

  expect(partition.pinned).toHaveLength(5)
  expect(ids(result.visible)).toEqual(ids(items.slice(5, 5 + RECENT_VISIBLE_LIMIT)))
})

test("opening a sidecar pin excludes its HTTP alias while keeping a different server's session", () => {
  const ownUrl = "http://127.0.0.1:4096"
  const sidecar = { type: "sidecar", variant: "base", http: { url: ownUrl } } as const

  const connections = resolveServerList({
    props: [sidecar],
    stored: ["http://localhost:4096", "http://localhost:4097"].map((url) => ({ type: "http", http: { url } })),
  })

  const greeting = session("ses_greeting", 10, { title: "Greeting" })

  const items = connections.flatMap((conn) =>
    mergeRecentSessions(ServerConnection.key(conn), [greeting], conn === sidecar ? [{ ...greeting }] : []),
  )

  const options = {
    endpoints: recentSessionEndpoints(connections, ownUrl),
    resolvePin: () => undefined,
    archived: () => false,
  }

  const open = new Set([items[1].key])
  expect(removePin(items.map((row) => row.key), items[1].key, options.endpoints)).toEqual([items[2].key])
  const result = partitionRecentSessions({ ...options, items, pins: addPin([], items[0].key), open })

  expect(result.pinned.map((row) => row.server)).toEqual(["sidecar"])
  expect(result.recent.map((row) => row.server)).toEqual(["http://localhost:4097"])

  for (const order of [items, items.toReversed()]) {
    const rows = partitionRecentSessions({ ...options, items: order, pins: [], open: new Set([items[0].key]) })
    expect(rows.recent.map((row) => row.key)).toEqual([items[2].key, items[0].key])
    const closed = partitionRecentSessions({ ...options, items: order, pins: [], open: new Set() })
    expect(closed.recent.map((row) => row.key)).toEqual([items[1].key, items[2].key])
  }
})

test("different sessions with the same title on one server remain independently pinnable", () => {
  const items = mergeRecentSessions("sidecar", [
    session("ses_first", 20, { title: "Greeting" }),
    session("ses_second", 10, { title: "Greeting" }),
  ], [])

  const result = partitionRecentSessions({
    items,
    endpoints: new Map(),
    pins: [items[0].key],
    open: new Set(),
    archived: () => false,
    resolvePin: () => undefined,
  })

  expect(result.pinned.map((row) => row.session.id)).toEqual(["ses_first"])
  expect(result.recent.map((row) => row.session.id)).toEqual(["ses_second"])
})

test("pins resolve hydrated sessions and unresolved pins stay hidden", () => {
  const known = item("server", session("ses_known", 10))
  const hydrated = item("server", session("ses_hydrated", 1))
  const missing = recentSessionKey("server", "ses_missing")

  const result = partitionRecentSessions({
    items: [known],
    endpoints: new Map(),
    open: new Set(),
    pins: [hydrated.key, missing, known.key],
    resolvePin: (key) => (key === hydrated.key ? hydrated : undefined),
    archived: () => false,
  })

  expect(result.pinned).toEqual([hydrated, known])
  expect(result.recent).toEqual([])
})


const readyPage = (
  sessions: readonly SessionInfo[],
  options: { cursor?: string; exhausted?: boolean; olderLoaded?: boolean } = {},
) => ({
  status: "ready" as const,
  sessions,
  cursor: options.cursor,
  exhausted: options.exhausted ?? options.cursor === undefined,
  olderLoaded: options.olderLoaded ?? false,
})

test("a short first page ends even though the server returns a next cursor", () => {
  const started = transitionRecentPage(INITIAL_RECENT_PAGE_STATE, { type: "load", kind: "first", attempt: 1 })
  expect(started.state).toMatchObject({ status: "loading", kind: "first", attempt: 1, sessions: [] })
  expect(started.effects).toEqual([
    { type: "fetch", attempt: 1, cursor: undefined },
    { type: "timer.start", attempt: 1, delayMs: RECENT_PAGE_TIMEOUT_MS },
  ])

  const page = [session("ses_a", 20), session("ses_b", 10)]
  const ended = transitionRecentPage(started.state, { type: "succeeded", attempt: 1, sessions: page, next: "at-last" })
  expect(ended.state).toMatchObject({ status: "ready", sessions: page, cursor: undefined, exhausted: true })
  expect(ended.effects).toEqual([{ type: "timer.cancel" }])
})

test("a next page merges into the rows already held and keeps a cursor", () => {
  const first = [session("ses_a", 20)]
  const next = Array.from({ length: RECENT_PAGE_LIMIT }, (_, i) => session(`ses_b${i}`, 10 - i))
  const state = readyPage(first, { cursor: "cursor-2" })
  const started = transitionRecentPage(state, { type: "load", kind: "next", attempt: 2 })

  expect(started.effects[0]).toEqual({ type: "fetch", attempt: 2, cursor: "cursor-2" })

  const page = transitionRecentPage(started.state, {
    type: "succeeded",
    attempt: 2,
    sessions: next,
    next: "cursor-3",
  })

  expect(page.state).toMatchObject({
    status: "ready",
    sessions: [...first, ...next],
    cursor: "cursor-3",
    exhausted: false,
    olderLoaded: true,
  })

  const third = transitionRecentPage(page.state, { type: "load", kind: "next", attempt: 3 })

  const final = transitionRecentPage(third.state, {
    type: "succeeded", attempt: 3, sessions: [session("ses_last", 1)], next: "at-last",
  })

  expect(final.state.exhausted).toBe(true)
  expect(final.state.cursor).toBeUndefined()
  expect(final.state.sessions.at(-1)?.id).toBe("ses_last")
})

test("an empty page ends pagination without dropping rows already shown", () => {
  const state = readyPage([session("ses_a", 20)], { cursor: "cursor-2" })
  const started = transitionRecentPage(state, { type: "load", kind: "next", attempt: 1 })
  const page = transitionRecentPage(started.state, { type: "succeeded", attempt: 1, sessions: [], next: undefined })

  expect(page.state).toMatchObject({
    status: "ready",
    sessions: [session("ses_a", 20)],
    cursor: undefined,
    exhausted: true,
  })
})

test("a failed page keeps its cursor and retries from it", () => {
  const state = readyPage([session("ses_a", 20)], { cursor: "cursor-2" })
  const started = transitionRecentPage(state, { type: "load", kind: "next", attempt: 1 })
  const failed = transitionRecentPage(started.state, { type: "failed", attempt: 1 })

  expect(failed.state).toMatchObject({ status: "failed", cursor: "cursor-2", exhausted: false, sessions: [session("ses_a", 20)] })
  expect(failed.effects).toEqual([{ type: "timer.cancel" }])

  const retried = transitionRecentPage(failed.state, { type: "retry", attempt: 2 })
  expect(retried.state).toMatchObject({ status: "loading", kind: "next", attempt: 2 })
  expect(retried.effects[0]).toEqual({ type: "fetch", attempt: 2, cursor: "cursor-2" })
})

test("a failed reconnect refresh retries the first page rather than its advanced cursor", () => {
  const state = readyPage([session("ses_a", 20)], { cursor: "cursor-old", olderLoaded: true })
  const started = transitionRecentPage(state, { type: "load", kind: "refresh", attempt: 1 })
  const failed = transitionRecentPage(started.state, { type: "failed", attempt: 1 })
  const retried = transitionRecentPage(failed.state, { type: "retry", attempt: 2 })

  expect(retried.state).toMatchObject({ status: "loading", kind: "refresh", attempt: 2 })
  expect(retried.effects[0]).toEqual({ type: "fetch", attempt: 2, cursor: undefined })
})

test("a timeout fails a hanging page and keeps its cursor", () => {
  const state = readyPage([session("ses_a", 20)], { cursor: "cursor-2" })
  const started = transitionRecentPage(state, { type: "load", kind: "next", attempt: 7 })
  const timedOut = transitionRecentPage(started.state, { type: "timed-out", attempt: 7 })

  expect(timedOut.state).toMatchObject({ status: "failed", cursor: "cursor-2" })
})

test("a short final page from a reconnect replaces the snapshot and ends pagination", () => {
  const state = readyPage([session("ses_first", 100), session("ses_older", 10)], {
    cursor: "cursor-old",
    olderLoaded: true,
  })

  const started = transitionRecentPage(state, { type: "load", kind: "refresh", attempt: 1 })

  const page = transitionRecentPage(started.state, {
    type: "succeeded",
    attempt: 1,
    sessions: [session("ses_first", 100)],
    next: "at-last",
  })

  expect(page.state).toMatchObject({
    status: "ready",
    sessions: [session("ses_first", 100)],
    cursor: undefined,
    exhausted: true,
    olderLoaded: false,
  })
})

test("a disconnected snapshot with a gap resets the list and its cursor", () => {
  const state = readyPage([session("ses_old", 10)], { cursor: "cursor-old", olderLoaded: true })
  const started = transitionRecentPage(state, { type: "load", kind: "refresh", attempt: 1 })
  const incoming = Array.from({ length: RECENT_PAGE_LIMIT }, (_, i) => session(`ses_new${i}`, 100 - i))

  const page = transitionRecentPage(started.state, {
    type: "succeeded",
    attempt: 1,
    sessions: incoming,
    next: "cursor-new",
  })

  expect(page.state).toMatchObject({
    status: "ready",
    sessions: incoming,
    cursor: "cursor-new",
    exhausted: false,
    olderLoaded: false,
  })
})

test("a reconnect snapshot drops page-one ghosts and keeps older rows and the advanced cursor", () => {
  const first = session("ses_first", 100)
  const ghost = session("ses_ghost", 90)
  const older = session("ses_older", 10)
  const incoming = [first, ...Array.from({ length: RECENT_PAGE_LIMIT - 1 }, (_, i) => session(`ses_new${i}`, 99 - i))]
  const state = readyPage([first, ghost, older], { cursor: "cursor-old", olderLoaded: true })
  const started = transitionRecentPage(state, { type: "load", kind: "refresh", attempt: 1 })

  const page = transitionRecentPage(started.state, {
    type: "succeeded",
    attempt: 1,
    sessions: incoming,
    next: "cursor-page-2",
  })

  expect(page.state.status).toBe("ready")
  expect(page.state.sessions.map((session) => session.id).toSorted()).toEqual([...incoming, older].map(s => s.id).toSorted())
  expect(page.state.cursor).toBe("cursor-old")
  expect(page.state.olderLoaded).toBe(true)
})

test("a reload waits for the first page, and otherwise starts page one again", () => {
  expect(transitionRecentPage(INITIAL_RECENT_PAGE_STATE, { type: "reload", attempt: 1 }).state).toBe(
    INITIAL_RECENT_PAGE_STATE,
  )

  const first = transitionRecentPage(INITIAL_RECENT_PAGE_STATE, { type: "load", kind: "first", attempt: 1 })
  expect(transitionRecentPage(first.state, { type: "reload", attempt: 2 }).state).toMatchObject({
    kind: "first",
    attempt: 2,
  })

  const reconnect = transitionRecentPage(readyPage([session("ses_a", 20)]), {
    type: "load",
    kind: "refresh",
    attempt: 3,
  })

  expect(transitionRecentPage(reconnect.state, { type: "reload", attempt: 4 }).state).toMatchObject({
    kind: "refresh",
    attempt: 4,
  })

  const reloaded = transitionRecentPage(readyPage([session("ses_a", 20)], { cursor: "cursor-2" }), {
    type: "reload",
    attempt: 5,
  })

  expect(reloaded.state).toMatchObject({ status: "loading", kind: "reload", cursor: "cursor-2" })
  expect(reloaded.effects[0]).toEqual({ type: "fetch", attempt: 5, cursor: undefined })
  expect(recentPageLoadingMore(reloaded.state)).toBe(false)
})

test("Show more stays while a snapshot reload runs, and gives way to the loader for its own page", () => {
  const state = readyPage([session("ses_a", 20)], { cursor: "cursor-2" })
  const reload = transitionRecentPage(state, { type: "reload", attempt: 1 })
  const refresh = transitionRecentPage(state, { type: "load", kind: "refresh", attempt: 2 })
  const next = transitionRecentPage(state, { type: "load", kind: "next", attempt: 3 })

  expect([state, reload.state, refresh.state, next.state].map(recentPageHasMore)).toEqual([true, true, true, false])
})

test("a reload supersedes Show more's page and keeps the older rows already loaded", () => {
  const first = session("ses_first", 100)
  const older = session("ses_older", 10)
  const state = readyPage([first, older], { cursor: "cursor-3", olderLoaded: true })
  const next = transitionRecentPage(state, { type: "load", kind: "next", attempt: 1 })
  expect(recentPageLoadingMore(next.state)).toBe(true)

  const reload = transitionRecentPage(next.state, { type: "reload", attempt: 2 })

  // The superseded page cannot land after the reload started.
  expect(
    transitionRecentPage(reload.state, { type: "succeeded", attempt: 1, sessions: [session("ses_x", 5)], next: "x" })
      .state,
  ).toBe(reload.state)

  const incoming = [
    session("ses_moved", 200),
    first,
    ...Array.from({ length: RECENT_PAGE_LIMIT - 2 }, (_, i) => session(`ses_new${i}`, 99 - i)),
  ]

  const page = transitionRecentPage(reload.state, {
    type: "succeeded",
    attempt: 2,
    sessions: incoming,
    next: "cursor-2",
  })

  expect(page.state).toMatchObject({ status: "ready", cursor: "cursor-3", olderLoaded: true })
  expect(page.state.sessions.map((entry) => entry.id).toSorted()).toEqual(
    [...incoming, older].map((entry) => entry.id).toSorted(),
  )

  const failed = transitionRecentPage(transitionRecentPage(page.state, { type: "reload", attempt: 3 }).state, {
    type: "failed",
    attempt: 3,
  })

  expect(transitionRecentPage(failed.state, { type: "retry", attempt: 4 }).state).toMatchObject({
    kind: "reload",
    sessions: page.state.sessions,
  })
})

test("run ends reload Recent except a known subagent's or a shutdown, as do new root sessions and archiving", () => {
  const sessions = new Map([
    ["ses_root", session("ses_root", 10)],
    ["ses_child", session("ses_child", 10, { parentID: "ses_root" })],
  ])

  const envelope = (sessionID: string) => ({
    id: `evt_${sessionID}`,
    created: 1,
    durable: { aggregateID: sessionID, seq: 1, version: 1 as const },
  })

  const ended = (sessionID: string) => ({
    ...envelope(sessionID),
    type: "session.execution.succeeded" as const,
    data: { sessionID },
  })

  const failed = (sessionID: string) => ({
    ...envelope(sessionID),
    type: "session.execution.failed" as const,
    data: { sessionID, error: { type: "unknown", message: "failed" } },
  })

  const interrupted = (sessionID: string, reason: "user" | "shutdown") => ({
    ...envelope(sessionID),
    type: "session.execution.interrupted" as const,
    data: { sessionID, reason },
  })

  const created = (sessionID: string, parentID?: string) => ({
    ...envelope(sessionID),
    type: "session.created" as const,
    data: { sessionID, projectID: "project", location: { directory: "/project" }, slug: sessionID, version: "1", parentID },
  })

  const cases: [OpenCodeEvent, boolean][] = [
    [ended("ses_root"), true],
    [failed("ses_root"), true],
    [interrupted("ses_root", "user"), true],
    [ended("ses_unknown"), true],
    [ended("ses_child"), false],
    [failed("ses_child"), false],
    [interrupted("ses_child", "user"), false],
    [interrupted("ses_root", "shutdown"), false],
    [created("ses_new"), true],
    [created("ses_sub", "ses_root"), false],
    [{ ...envelope("ses_root"), type: "session.archived", data: { sessionID: "ses_root" } }, true],
    [{ ...envelope("ses_root"), type: "session.unarchived", data: { sessionID: "ses_root" } }, true],
    [{ ...envelope("ses_root"), type: "session.renamed", data: { sessionID: "ses_root", title: "Renamed" } }, false],
  ]

  expect(cases.map(([value]) => recentReloadsOn(value, (id) => sessions.get(id)))).toEqual(
    cases.map(([, expected]) => expected),
  )
})

test("removing a server clears its page", () => {
  const state = readyPage([session("ses_a", 20)], { cursor: "cursor-2" })
  const removed = transitionRecentPage(state, { type: "removed" })

  expect(removed.state).toEqual(INITIAL_RECENT_PAGE_STATE)
  expect(removed.effects).toEqual([{ type: "timer.cancel" }])
})

import { expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import {
  addPin,
  dedupePins,
  mergeFirstPage,
  mergeRecentSessions,
  mergeSessionSearch,
  partitionRecentSessions,
  recentSessionKey,
  removePin,
  reorderPins,
  sortRecentSessions,
  splitRecentSessionKey,
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

test("pin keys round trip server keys that contain the separator's neighbours", () => {
  const key = recentSessionKey("http://server.example:4096", "ses_1")

  expect(splitRecentSessionKey(key)).toEqual({ server: "http://server.example:4096", sessionID: "ses_1" })
  expect(splitRecentSessionKey("ses_1")).toBeUndefined()
})

test("pinning appends once and unpinning keeps the other order", () => {
  const pins = addPin(addPin([], "a"), "b")

  expect(pins).toEqual(["a", "b"])
  expect(addPin(pins, "a")).toEqual(["a", "b"])
  expect(removePin(pins, "a")).toEqual(["b"])
  expect(removePin(pins, "missing")).toEqual(["a", "b"])
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

test("a refreshed first page replaces the snapshot until older pages load", () => {
  const first = [session("ses_a", 10), session("ses_b", 5)]
  const refreshed = [session("ses_a", 20), session("ses_c", 30)]

  expect(mergeFirstPage(first, refreshed, false)).toEqual(refreshed)
})

test("a refreshed first page merges once older pages are loaded, incoming rows winning", () => {
  const existing = [session("ses_a", 10), session("ses_older_page", 1)]
  const refreshed = [session("ses_a", 20), session("ses_c", 30)]

  expect(mergeFirstPage(existing, refreshed, true)).toEqual([
    session("ses_a", 20),
    session("ses_older_page", 1),
    session("ses_c", 30),
  ])
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
    item("server", session("ses_a", 20, { title: "loaded" })),
    item("server", session("ses_live", 5)),
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

test("search results keep only sessions the server returned but use the live copy", () => {
  const results = [session("ses_a", 10, { title: "result" })]
  const known = [session("ses_a", 20, { title: "live" }), session("ses_b", 30)]

  expect(mergeSessionSearch("server", results, known)).toEqual([
    item("server", session("ses_a", 20, { title: "live" })),
  ])
})

test("pins keep their order, leave Recent, and hide archived sessions without dropping the key", () => {
  const a = item("server", session("ses_a", 10))
  const b = item("server", session("ses_b", 20))
  const c = item("server", session("ses_c", 30))
  const archived = new Set([recentSessionKey("server", "ses_b")])

  const result = partitionRecentSessions({
    items: [a, b, c],
    pins: [b.key, a.key],
    resolvePin: () => undefined,
    archived: (key) => archived.has(key),
  })

  expect(result.pinned).toEqual([a])
  expect(result.recent).toEqual([c])
})

test("pins resolve hydrated sessions and unresolved pins stay hidden", () => {
  const known = item("server", session("ses_known", 10))
  const hydrated = item("server", session("ses_hydrated", 1))
  const missing = recentSessionKey("server", "ses_missing")

  const result = partitionRecentSessions({
    items: [known],
    pins: [hydrated.key, missing, known.key],
    resolvePin: (key) => (key === hydrated.key ? hydrated : undefined),
    archived: () => false,
  })

  expect(result.pinned).toEqual([hydrated, known])
  expect(result.recent).toEqual([])
})

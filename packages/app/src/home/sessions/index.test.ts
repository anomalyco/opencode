import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode-ai/client/promise"
import { SESSION_RECENT_LIMIT, SESSION_RECENT_WINDOW } from "@/runtime/server/global-sync/types"
import {
  HOME_SESSION_INDEX_LIMIT,
  HOME_SESSION_LIMIT,
  HOME_V2_SESSION_PAGE_LIMIT,
  loadHomeSessionIndex,
  mergeHomeSessionIndex,
  parseHomeSessionIndex,
  retainHomeSessions,
} from "./index"

const session = (id: string, input: Partial<SessionInfo> = {}) =>
  ({
    id,
    projectID: "project",
    title: id,
    time: { created: 1, updated: 1 },
    location: { directory: "/repo" },
    ...input,
  }) as SessionInfo

// The loader anchors its recent window on the wall clock, so fixtures do too.
const now = Date.now()
const minute = 60_000

// One session per minute going back from `now`; index 0 is the newest, which
// is the server's list order.
const history = (directory: string, count: number) =>
  Array.from({ length: count }, (_, index) =>
    session(`${directory}-${String(index).padStart(5, "0")}`, {
      time: { created: now - (index + 1) * minute - 1000, updated: now - (index + 1) * minute },
      location: { directory },
    }),
  )

const ids = (sessions: SessionInfo[]) => sessions.map((item) => item.id)

describe("Home session index", () => {
  test("follows cursors across pages and bounds the result per directory", async () => {
    const all = history("/repo", HOME_V2_SESSION_PAGE_LIMIT + 1)
    const calls: Array<{ cursor?: string; parentID: null }> = []
    const result = await loadHomeSessionIndex(async (input) => {
      calls.push(input)
      if (!input.cursor) return { data: all.slice(0, HOME_V2_SESSION_PAGE_LIMIT), cursor: { next: "next" } }
      return { data: all.slice(HOME_V2_SESSION_PAGE_LIMIT), cursor: {} }
    })

    expect(calls.map((call) => call.cursor)).toEqual([undefined, "next"])
    expect(calls.every((call) => call.parentID === null)).toBe(true)
    // Newest rows in server order, plus the recent window beyond the limit.
    expect(ids(result)).toEqual(ids(all.slice(0, HOME_SESSION_INDEX_LIMIT + SESSION_RECENT_LIMIT)))
  })

  test("folds pages so every directory keeps its newest sessions", async () => {
    const busy = history("/busy", HOME_V2_SESSION_PAGE_LIMIT + 300)
    const quiet = history("/quiet", 3).map((item) => ({
      ...item,
      time: { created: item.time.created - 6000 * minute, updated: item.time.updated - 6000 * minute },
    }))
    // Server order is global by updated time: /quiet is older than all of /busy
    // and only arrives on the second page.
    const result = await loadHomeSessionIndex(async (input) => {
      if (!input.cursor) return { data: busy.slice(0, HOME_V2_SESSION_PAGE_LIMIT), cursor: { next: "next" } }
      return { data: [...busy.slice(HOME_V2_SESSION_PAGE_LIMIT), ...quiet], cursor: {} }
    })
    expect(ids(result.filter((item) => item.location.directory === "/quiet"))).toEqual(ids(quiet))
    expect(ids(result.filter((item) => item.location.directory === "/busy"))).toEqual(
      ids(busy.slice(0, HOME_SESSION_INDEX_LIMIT + SESSION_RECENT_LIMIT)),
    )
  })

  test("drops archived sessions before they can occupy a retained slot", async () => {
    const archived = history("/repo", 200).map((item) => ({ ...item, time: { ...item.time, archived: now } }))
    const live = history("/repo", 10).map((item) => ({
      ...item,
      id: `live-${item.id}`,
      time: { created: item.time.created - 300 * minute, updated: item.time.updated - 300 * minute },
    }))
    const result = await loadHomeSessionIndex(async () => ({ data: [...archived, ...live], cursor: {} }))
    expect(ids(result)).toEqual(ids(live))
  })

  test("keeps only visible roots", () => {
    expect(
      parseHomeSessionIndex([
        session("root"),
        session("child", { parentID: "root" }),
        session("archived", { time: { created: 1, updated: 1, archived: 2 } }),
      ]).map((item) => item.id),
    ).toEqual(["root"])
  })

  test("preserves the per-directory retention limit", () => {
    const result = retainHomeSessions(
      [session("a", { time: { created: 1, updated: 1 } }), session("b", { time: { created: 2, updated: 2 } })],
      1,
      now,
    )
    expect(result.map((item) => item.id)).toEqual(["b"])
  })
})

// Home merges locally known sessions and pending removals into the fetched
// index on every store change, then retains per directory for display and
// search. The loaded subset must resolve to the same set as the complete index.
describe("Home session index parity with the complete index", () => {
  const complete = [...history("/a", 400), ...history("/b", 90), ...history("/c", 5)]
  const view = (index: SessionInfo[], known: SessionInfo[], removed = new Set<string>()) =>
    ids(
      retainHomeSessions(
        mergeHomeSessionIndex(index, known).filter((item) => !removed.has(item.id)),
        HOME_SESSION_LIMIT,
        now,
      ),
    ).toSorted()
  const loaded = () => loadHomeSessionIndex(async () => ({ data: complete, cursor: {} }))

  test("without local changes", async () => {
    const result = view(await loaded(), [])
    expect(result).toEqual(view(complete, []))
    expect(result).toHaveLength(HOME_SESSION_LIMIT + SESSION_RECENT_LIMIT + 90 + 5)
  })

  test("with new, re-timed, and unlisted-directory local sessions", async () => {
    const known = [
      session("a-fresh", { time: { created: now, updated: now }, location: { directory: "/a" } }),
      // A fetched session that fell outside retention but was updated locally.
      { ...complete[300], time: { created: now - 1, updated: now } },
      session("d-new", { time: { created: now, updated: now }, location: { directory: "/d" } }),
    ]
    const result = view(await loaded(), known)
    expect(result).toEqual(view(complete, known))
    expect(result).toContain("a-fresh")
    expect(result).toContain(complete[300].id)
    expect(result).toContain("d-new")
  })

  test("with pending removals up to the recent-window bucket size", async () => {
    const removed = new Set(ids(complete.slice(0, SESSION_RECENT_LIMIT)))
    const result = view(await loaded(), [], removed)
    expect(result).toEqual(view(complete, [], removed))
    expect(result).toHaveLength(HOME_SESSION_LIMIT + SESSION_RECENT_LIMIT + 90 + 5)
    expect(result.some((id) => removed.has(id))).toBe(false)
  })

  test("with a directory entirely inside the recent window", async () => {
    const hot = history("/hot", 300).map((item, index) => ({
      ...item,
      time: { created: now - index * 1000 - 500, updated: now - index * 1000 },
    }))
    expect(hot.every((item) => item.time.updated > now - SESSION_RECENT_WINDOW)).toBe(true)
    const index = await loadHomeSessionIndex(async () => ({ data: hot, cursor: {} }))
    expect(index).toHaveLength(HOME_SESSION_INDEX_LIMIT + SESSION_RECENT_LIMIT)
    expect(view(index, [])).toEqual(view(hot, []))
  })
})

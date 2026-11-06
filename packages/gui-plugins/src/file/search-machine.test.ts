import { describe, expect, test } from "bun:test"
import {
  FILE_SEARCH_TIMEOUT_MS,
  INITIAL_FILE_SEARCH_STATE,
  fileSearchView,
  transitionFileSearch,
  type FileSearchEffect,
  type FileSearchEvent,
  type FileSearchScope,
  type FileSearchState,
} from "./search-machine"

const alpha: FileSearchScope = { serverID: "local", root: "C:/alpha" }

const beta: FileSearchScope = { serverID: "local", root: "C:/beta" }

const typed = (query: string, scope = alpha, connected = true): FileSearchEvent => ({
  type: "context.changed",
  context: { scope, connected, query },
})

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: FileSearchState, ...events: FileSearchEvent[]) {
  return events.reduce<{ state: FileSearchState; effects: readonly FileSearchEffect[] }>(
    (result, event) => {
      const next = transitionFileSearch(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

const found = (attempt: number, ...files: string[]): FileSearchEvent => ({ type: "search.succeeded", attempt, files })

describe("transitionFileSearch", () => {
  test("a query searches its workspace and lists the results once", () => {
    const result = play(INITIAL_FILE_SEARCH_STATE, typed("auth"), found(1, "src/auth.ts", "src/auth.ts"))

    expect(result.effects).toEqual([
      { type: "search", scope: alpha, query: "auth", attempt: 1, timeoutMs: FILE_SEARCH_TIMEOUT_MS },
    ])
    expect(fileSearchView(result.state)).toEqual({ status: "results", files: ["src/auth.ts"], stale: false })
  })

  // Another session's workspace used to show, and open, the previous workspace's results while its own search waited.
  test("another workspace never shows the previous workspace's results", () => {
    const auth = play(INITIAL_FILE_SEARCH_STATE, typed("auth"), found(1, "src/auth.ts"))

    expect(fileSearchView(transitionFileSearch(auth.state, typed("main", beta, false)).state)).toEqual({
      status: "offline",
    })

    const slow = transitionFileSearch(auth.state, typed("main", beta))

    expect(fileSearchView(slow.state)).toEqual({ status: "loading" })
    expect(slow.effects).toEqual([
      { type: "search", scope: beta, query: "main", attempt: 2, timeoutMs: FILE_SEARCH_TIMEOUT_MS },
    ])
  })

  // Enter used to open the previous query's first result while the new query loaded.
  test("the previous query's results stay shown but cannot be picked until the new ones arrive", () => {
    const typing = play(INITIAL_FILE_SEARCH_STATE, typed("a"), found(1, "a.ts"), typed("ab"))

    expect(fileSearchView(typing.state)).toEqual({ status: "results", files: ["a.ts"], stale: true })

    const next = transitionFileSearch(typing.state, found(2, "ab.ts"))

    expect(fileSearchView(next.state)).toEqual({ status: "results", files: ["ab.ts"], stale: false })
  })

  // A failed search used to read "No matching files".
  test("a failed search shows the failure, and Try again searches again", () => {
    const failed = play(INITIAL_FILE_SEARCH_STATE, typed("auth"), {
      type: "search.failed",
      attempt: 1,
      message: "Internal error",
    })

    expect(fileSearchView(failed.state)).toEqual({
      status: "error",
      failure: { type: "rejected", message: "Internal error" },
    })

    const retried = play(failed.state, { type: "retry" }, found(2, "src/auth.ts"))

    expect(retried.effects).toEqual([
      { type: "search", scope: alpha, query: "auth", attempt: 2, timeoutMs: FILE_SEARCH_TIMEOUT_MS },
    ])
    expect(fileSearchView(retried.state)).toEqual({ status: "results", files: ["src/auth.ts"], stale: false })
  })

  // A search that never answered, or one typed while disconnected, used to load forever.
  test("a search that takes too long fails, and one typed offline runs once the server is back", () => {
    const timed = play(INITIAL_FILE_SEARCH_STATE, typed("auth"), { type: "search.timed-out", attempt: 1 })

    expect(timed.effects.at(-1)).toEqual({ type: "abort", attempt: 1 })
    expect(fileSearchView(timed.state)).toEqual({ status: "error", failure: { type: "timeout" } })

    const offline = play(INITIAL_FILE_SEARCH_STATE, typed("auth", alpha, false))

    expect(offline.effects).toEqual([])
    expect(fileSearchView(offline.state)).toEqual({ status: "offline" })
    expect(transitionFileSearch(offline.state, typed("auth")).effects).toEqual([
      { type: "search", scope: alpha, query: "auth", attempt: 1, timeoutMs: FILE_SEARCH_TIMEOUT_MS },
    ])
  })

  test("a disconnect keeps the results shown and reconnecting loads them again", () => {
    const shown = play(INITIAL_FILE_SEARCH_STATE, typed("auth"), found(1, "src/auth.ts"), typed("auth", alpha, false))

    expect(fileSearchView(shown.state)).toEqual({ status: "results", files: ["src/auth.ts"], stale: false })
    expect(transitionFileSearch(shown.state, typed("auth")).effects).toEqual([
      { type: "search", scope: alpha, query: "auth", attempt: 2, timeoutMs: FILE_SEARCH_TIMEOUT_MS },
    ])
  })

  test("a newer query withdraws the running search and drops its answer", () => {
    const typing = play(INITIAL_FILE_SEARCH_STATE, typed("a"), typed("ab"))

    expect(typing.effects.slice(1)).toEqual([
      { type: "abort", attempt: 1 },
      { type: "search", scope: alpha, query: "ab", attempt: 2, timeoutMs: FILE_SEARCH_TIMEOUT_MS },
    ])
    expect(transitionFileSearch(typing.state, found(1, "a.ts")).state).toBe(typing.state)
  })

  test("clearing the filter or closing the browser ends the search", () => {
    const searching = play(INITIAL_FILE_SEARCH_STATE, typed("auth"))
    const cleared = transitionFileSearch(searching.state, typed(""))

    expect(cleared.effects).toEqual([{ type: "abort", attempt: 1 }])
    expect(fileSearchView(cleared.state)).toEqual({ status: "tree" })

    const disposed = transitionFileSearch(searching.state, { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "abort", attempt: 1 }])
    expect(transitionFileSearch(disposed.state, found(1, "src/auth.ts")).state).toBe(disposed.state)
  })
})

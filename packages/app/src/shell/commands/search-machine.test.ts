import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import type { CommandPaletteEntry } from "./palette"
import {
  INITIAL_SESSION_SOURCE_STATE,
  createPaletteSearchState,
  selectPaletteSearchFailed,
  selectPaletteSearchLoading,
  selectPaletteSearchSources,
  transitionPaletteSearch,
  transitionSessionSource,
  type PaletteSearchEffect,
  type PaletteSearchEvent,
  type PaletteSearchState,
  type SessionSourceEffect,
  type SessionSourceEvent,
  type SessionSourceState,
} from "./search-machine"

const local: CommandPaletteEntry = { id: "session:a:ses_a", type: "session", title: "Server A match", category: "Session" }

function search(events: PaletteSearchEvent[], state: PaletteSearchState = createPaletteSearchState(2)) {
  return events.reduce<{ state: PaletteSearchState; effects: PaletteSearchEffect[] }>(
    (acc, event) => {
      const next = transitionPaletteSearch(acc.state, event)

      return { state: next.state, effects: [...acc.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

function source(events: SessionSourceEvent[], state: SessionSourceState = INITIAL_SESSION_SOURCE_STATE) {
  return events.reduce<{ state: SessionSourceState; effects: SessionSourceEffect[] }>(
    (acc, event) => {
      const next = transitionSessionSource(acc.state, event)

      return { state: next.state, effects: [...acc.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

describe("palette search machine", () => {
  test("one failing server keeps the other server's results and only fails itself", () => {
    const result = search([
      { type: "query.changed", query: "match" },
      { type: "source.resolved", index: 0, attempt: 1, items: [local] },
      { type: "source.failed", index: 1, attempt: 2 },
    ])

    expect(selectPaletteSearchSources(result.state).map((item) => [item.status, item.settled.items])).toEqual([
      ["ready", [local]],
      ["failed", []],
    ])
    expect(selectPaletteSearchLoading(result.state)).toBe(false)
    expect(selectPaletteSearchFailed(result.state)).toBe(true)
  })

  test("a fast source publishes while a slow one still loads", () => {
    const result = search([
      { type: "query.changed", query: "match" },
      { type: "source.resolved", index: 0, attempt: 1, items: [local] },
    ])

    expect(selectPaletteSearchSources(result.state)[0]?.settled.items).toEqual([local])
    expect(selectPaletteSearchLoading(result.state)).toBe(true)
  })

  test("searching a query that failed before is not a failure while it loads again", () => {
    const result = search(
      [
        { type: "query.changed", query: "abc" },
        { type: "source.failed", index: 0, attempt: 1 },
        { type: "query.changed", query: "abcd" },
        { type: "query.changed", query: "abc" },
      ],
      createPaletteSearchState(1),
    )

    expect(selectPaletteSearchLoading(result.state)).toBe(true)
    expect(selectPaletteSearchFailed(result.state)).toBe(false)
    expect(result.effects).toEqual([
      { type: "source.load", index: 0, attempt: 1, query: "abc", timeoutMs: 10_000 },
      { type: "source.load", index: 0, attempt: 2, query: "abcd", timeoutMs: 10_000 },
      { type: "source.abort", attempt: 2 },
      { type: "source.load", index: 0, attempt: 3, query: "abc", timeoutMs: 10_000 },
    ])
  })

  test("a source that hangs times out, aborts and stops the loading state", () => {
    const result = search([{ type: "query.changed", query: "abc" }, { type: "source.timed-out", index: 1, attempt: 2 }])

    expect(result.effects.at(-1)).toEqual({ type: "source.abort", attempt: 2 })
    expect(selectPaletteSearchSources(result.state)[1]?.status).toBe("failed")

    const late = search([{ type: "source.resolved", index: 1, attempt: 2, items: [local] }], result.state)
    expect(late.state).toBe(result.state)
  })

  test("a stale answer is ignored, results seen for a query are kept, and disposing aborts the rest", () => {
    const result = search(
      [
        { type: "query.changed", query: "a" },
        { type: "query.changed", query: "ab" },
        { type: "source.resolved", index: 0, attempt: 1, items: [local] },
        { type: "source.resolved", index: 0, attempt: 2, items: [local] },
        { type: "query.changed", query: "abc" },
      ],
      createPaletteSearchState(1),
    )

    expect(selectPaletteSearchSources(result.state)).toEqual([
      { status: "loading", attempt: 3, settled: { query: "ab", items: [local] }, seen: [local] },
    ])
    expect(search([{ type: "disposed" }], result.state)).toEqual({
      state: { status: "disposed" },
      effects: [{ type: "source.abort", attempt: 3 }],
    })
  })
})

const sessionA: SessionInfo = {
  id: "ses_a",
  projectID: "proj",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  location: { directory: "/project" },
  title: "Palette",
  time: { created: 1, updated: 1 },
}

describe("session source machine", () => {
  test("a newer search cancels the one still waiting for a pause", () => {
    const result = source([
      { type: "search.requested", query: "pal", delayMs: 100 },
      { type: "search.requested", query: "palette", delayMs: 100 },
      { type: "debounce.fired", attempt: 1 },
      { type: "debounce.fired", attempt: 2 },
    ])

    expect(result.effects).toEqual([
      { type: "debounce.start", attempt: 1, delayMs: 100 },
      { type: "attempt.cancel", attempt: 1 },
      { type: "debounce.start", attempt: 2, delayMs: 100 },
      { type: "fetch.start", attempt: 2, query: "palette" },
    ])
  })

  test("the caller's abort cancels the search while it waits and while it fetches", () => {
    const waiting = source([
      { type: "search.requested", query: "pal", delayMs: 100 },
      { type: "search.aborted", attempt: 1 },
      { type: "debounce.fired", attempt: 1 },
    ])
    expect(waiting.state).toMatchObject({ status: "idle", issued: 1 })
    expect(waiting.effects.slice(1)).toEqual([{ type: "attempt.cancel", attempt: 1 }])

    const fetching = source([
      { type: "search.requested", query: "pal", delayMs: 100 },
      { type: "debounce.fired", attempt: 1 },
      { type: "search.aborted", attempt: 1 },
      { type: "fetch.succeeded", attempt: 1, sessions: [sessionA] },
    ])
    expect(fetching.state).toEqual({ status: "idle", issued: 1, loaded: [] })
    expect(fetching.effects.at(-1)).toEqual({ type: "attempt.cancel", attempt: 1 })
  })

  test("found sessions are kept by ID across searches, and a failure answers its caller", () => {
    const renamed = { ...sessionA, title: "Palette renamed" }
    const result = source([
      { type: "search.requested", query: "pal", delayMs: 100 },
      { type: "debounce.fired", attempt: 1 },
      { type: "fetch.succeeded", attempt: 1, sessions: [sessionA] },
      { type: "search.requested", query: "palette", delayMs: 100 },
      { type: "debounce.fired", attempt: 2 },
      { type: "fetch.succeeded", attempt: 2, sessions: [renamed] },
    ])
    expect(result.state.loaded).toEqual([renamed])

    const error = new Error("offline")
    const failed = source(
      [
        { type: "search.requested", query: "x", delayMs: 100 },
        { type: "debounce.fired", attempt: 3 },
        { type: "fetch.failed", attempt: 3, error },
      ],
      result.state,
    )
    expect(failed.effects.at(-1)).toEqual({ type: "attempt.reject", attempt: 3, error })
    expect(failed.state.loaded).toEqual([renamed])
  })

  test("disposing cancels the running search and ignores later requests", () => {
    const result = source([
      { type: "search.requested", query: "pal", delayMs: 0 },
      { type: "disposed" },
      { type: "search.requested", query: "palette", delayMs: 0 },
    ])

    expect(result.state).toEqual({ status: "disposed", loaded: [] })
    expect(result.effects.slice(1)).toEqual([{ type: "attempt.cancel", attempt: 1 }])
  })
})

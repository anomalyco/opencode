import { describe, expect, test } from "bun:test"
import type { ComposerSuggestion } from "../types"
import {
  INITIAL_MENTION_SEARCH_STATE,
  MENTION_FILE_DEBOUNCE_MS,
  MENTION_SEARCH_TIMEOUT_MS,
  isMentionFileStale,
  selectMentionFiles,
  selectMentionSessionsPending,
  transitionMentionSearch,
  type MentionSearchEvent,
  type MentionSearchState,
  type MentionSearchTransition,
} from "./mention-search-machine"

const plan: ComposerSuggestion = { id: "file:re/plan.md", kind: "file", label: "re/plan.md", path: "re/plan.md" }

function replay(events: MentionSearchEvent[], state: MentionSearchState = INITIAL_MENTION_SEARCH_STATE) {
  const initial: MentionSearchTransition = { state, effects: [] }

  return events.reduce((result, event) => transitionMentionSearch(result.state, event), initial)
}

function changed(query: string, hasSessions = true): MentionSearchEvent {
  return { type: "context.changed", query, hasSessions }
}

describe("transitionMentionSearch", () => {
  test("reopening @ on a word searched before waits for a fresh session search", () => {
    const reopened = replay([
      changed("auth"),
      { type: "session.settled", attempt: 2 },
      { type: "context.closed" },
      changed("auth "),
    ])

    expect(reopened.effects).toEqual([
      { type: "session.search", attempt: 3, word: "auth", timeoutMs: MENTION_SEARCH_TIMEOUT_MS },
    ])
    expect(selectMentionSessionsPending(reopened.state, "auth ", true)).toBe(true)
    expect(
      selectMentionSessionsPending(
        transitionMentionSearch(reopened.state, { type: "session.settled", attempt: 3 }).state,
        "auth ",
        true,
      ),
    ).toBe(false)
  })

  test("closing @ aborts its pending file and session searches", () => {
    const loading = replay([changed("re"), { type: "file.debounce.fired", attempt: 1 }])

    expect(loading.effects).toEqual([
      { type: "file.search", attempt: 1, query: "re", timeoutMs: MENTION_SEARCH_TIMEOUT_MS },
    ])
    expect(transitionMentionSearch(loading.state, { type: "context.closed" })).toEqual({
      state: { status: "closed", issued: 2 },
      effects: [
        { type: "file.abort", attempt: 1 },
        { type: "session.abort", attempt: 2 },
      ],
    })
  })

  test("a failed or timed-out file search clears the previous query's rows", () => {
    const typed = replay([
      changed("re", false),
      { type: "file.debounce.fired", attempt: 1 },
      { type: "file.resolved", attempt: 1, items: [plan] },
      changed("rez", false),
    ])

    expect(typed.effects).toEqual([{ type: "file.debounce", attempt: 2, delayMs: MENTION_FILE_DEBOUNCE_MS }])
    expect(selectMentionFiles(typed.state)).toEqual([plan])
    expect(isMentionFileStale(typed.state, "rez")).toBe(true)

    for (const type of ["file.failed", "file.timed-out"] as const) {
      const settled = replay([{ type: "file.debounce.fired", attempt: 2 }, { type, attempt: 2 }], typed.state)

      expect(selectMentionFiles(settled.state)).toEqual([])
      expect(isMentionFileStale(settled.state, "rez")).toBe(false)
      expect(settled.effects).toEqual([{ type: "file.abort", attempt: 2 }])
    }
  })

  test("refining a title keeps the in-flight session search and drops file search", () => {
    const first = replay([changed("auth")])
    const refined = transitionMentionSearch(first.state, changed("auth token"))

    expect(refined.effects).toEqual([{ type: "file.abort", attempt: 1 }])
    expect(refined.state).toMatchObject({ files: { status: "idle" }, sessions: { status: "loading", attempt: 2 } })
    expect(transitionMentionSearch(refined.state, changed("auth token")).state).toBe(refined.state)
  })

  test("ignores stale results and everything after dispose", () => {
    const first = replay([changed("re", false), changed("res", false)])

    expect(transitionMentionSearch(first.state, { type: "file.debounce.fired", attempt: 1 }).state).toBe(first.state)

    const disposed = transitionMentionSearch(first.state, { type: "disposed" })

    expect(disposed).toEqual({ state: { status: "disposed" }, effects: [{ type: "file.abort", attempt: 2 }] })
    expect(transitionMentionSearch(disposed.state, changed("re")).state).toBe(disposed.state)
  })
})

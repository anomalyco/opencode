import { describe, expect, test } from "bun:test"
import { moveHistoryEntry, type PromptInfo } from "../src/prompt/history"

// Regression test for session-scoped prompt history recall.
//
// The history was one global list: `move()` walked every entry ever appended,
// so up-arrow in one session recalled prompts typed in completely different
// sessions. Entries now carry an optional `sessionID` and navigation is scoped
// to the active session; entries without a `sessionID` (written by older
// versions) stay in the file but are not recalled for a session.

function entry(input: string, sessionID?: string): PromptInfo {
  return sessionID ? { input, parts: [], sessionID } : { input, parts: [] }
}

describe("moveHistoryEntry", () => {
  test("recalls only the active session's entries", () => {
    const history = [entry("s1 first", "s1"), entry("s2 only", "s2"), entry("s1 second", "s1")]
    const first = moveHistoryEntry(history, 0, -1, "", "s1")
    expect(first?.entry.input).toBe("s1 second")
    const second = moveHistoryEntry(history, first!.index, -1, "s1 second", "s1")
    expect(second?.entry.input).toBe("s1 first")
  })

  test("a session without its own entries recalls nothing", () => {
    const history = [entry("s1 first", "s1"), entry("s1 second", "s1")]
    expect(moveHistoryEntry(history, 0, -1, "", "s9")).toBeUndefined()
  })

  test("legacy entries without a sessionID are not recalled for a session", () => {
    const history = [entry("legacy prompt"), entry("s1 only", "s1")]
    expect(moveHistoryEntry(history, 0, -1, "", "s9")).toBeUndefined()
    const item = moveHistoryEntry(history, 0, -1, "", "s1")
    expect(item?.entry.input).toBe("s1 only")
  })

  test("a stale offset pointing at another session restarts from the live input", () => {
    const history = [entry("s1 first", "s1"), entry("s2 only", "s2")]
    // index -1 points at "s2 only" after navigating in s2; moving in s1 must
    // not resume from a foreign entry.
    const item = moveHistoryEntry(history, -1, -1, "", "s1")
    expect(item?.index).toBe(-1)
    expect(item?.entry.input).toBe("s1 first")
  })

  test("down-arrow returns to the live input", () => {
    const history = [entry("s1 first", "s1"), entry("s1 second", "s1")]
    const up = moveHistoryEntry(history, 0, -1, "", "s1")
    const down = moveHistoryEntry(history, up!.index, 1, "s1 second", "s1")
    expect(down?.index).toBe(0)
    expect(down?.entry).toEqual({ input: "", parts: [] })
  })

  test("without a sessionID navigation walks the whole list as before", () => {
    const history = [entry("old"), entry("new")]
    const item = moveHistoryEntry(history, 0, -1, "")
    expect(item?.entry.input).toBe("new")
  })

  test("does not move when the typed input was edited mid-navigation", () => {
    const history = [entry("s1 first", "s1"), entry("s1 second", "s1")]
    expect(moveHistoryEntry(history, -1, -1, "edited draft", "s1")).toBeUndefined()
  })

  test("stopping at the oldest entry repeats it instead of going out of bounds", () => {
    const history = [entry("s1 first", "s1"), entry("s1 second", "s1")]
    const first = moveHistoryEntry(history, 0, -1, "", "s1")
    const second = moveHistoryEntry(history, first!.index, -1, "s1 second", "s1")
    expect(second?.entry.input).toBe("s1 first")
    const again = moveHistoryEntry(history, second!.index, -1, "s1 first", "s1")
    expect(again?.entry.input).toBe("s1 first")
    expect(again?.index).toBe(-2)
  })
})

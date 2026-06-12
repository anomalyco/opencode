import { describe, expect, test } from "bun:test"
import {
  changeModeTitleKey,
  createChangeModeOptions,
  defaultChangeMode,
  reviewDiffsForMode,
  reviewReadyForMode,
} from "./session-review-mode"

const sessionDiff = { file: "session.ts", additions: 1, deletions: 0, status: "modified" as const }
const turnDiff = { file: "turn.ts", additions: 2, deletions: 1, status: "modified" as const }
const gitDiff = { file: "git.ts", additions: 3, deletions: 0, status: "added" as const }

describe("session review mode", () => {
  test("defaults review to current session changes", () => {
    expect(defaultChangeMode).toBe("session")
  })

  test("lists session changes before git, branch, and turn modes", () => {
    expect(
      createChangeModeOptions({
        vcs: "git",
        branch: "feature",
        defaultBranch: "main",
      }),
    ).toEqual(["session", "git", "branch", "turn"])
  })

  test("uses session diffs for the session review mode", () => {
    expect(
      reviewDiffsForMode({
        mode: "session",
        sessionDiffs: [sessionDiff],
        turnDiffs: [turnDiff],
        vcsDiffs: [gitDiff],
        vcsFetched: true,
      }),
    ).toEqual([sessionDiff])
  })

  test("uses fetched vcs diffs for git and branch modes", () => {
    expect(
      reviewDiffsForMode({
        mode: "git",
        sessionDiffs: [sessionDiff],
        turnDiffs: [turnDiff],
        vcsDiffs: [gitDiff],
        vcsFetched: true,
      }),
    ).toEqual([gitDiff])
    expect(
      reviewDiffsForMode({
        mode: "branch",
        sessionDiffs: [sessionDiff],
        turnDiffs: [turnDiff],
        vcsDiffs: [gitDiff],
        vcsFetched: false,
      }),
    ).toEqual([])
  })

  test("uses turn diffs for last turn mode", () => {
    expect(
      reviewDiffsForMode({
        mode: "turn",
        sessionDiffs: [sessionDiff],
        turnDiffs: [turnDiff],
        vcsDiffs: [gitDiff],
        vcsFetched: true,
      }),
    ).toEqual([turnDiff])
  })

  test("waits for session diff loading before reporting review ready", () => {
    expect(reviewReadyForMode({ mode: "session", sessionDiffsLoaded: false, vcsPending: false })).toBe(false)
    expect(reviewReadyForMode({ mode: "session", sessionDiffsLoaded: true, vcsPending: false })).toBe(true)
  })

  test("waits for vcs loading only for git and branch modes", () => {
    expect(reviewReadyForMode({ mode: "git", sessionDiffsLoaded: false, vcsPending: true })).toBe(false)
    expect(reviewReadyForMode({ mode: "branch", sessionDiffsLoaded: false, vcsPending: false })).toBe(true)
    expect(reviewReadyForMode({ mode: "turn", sessionDiffsLoaded: false, vcsPending: true })).toBe(true)
  })

  test("maps session mode to a dedicated title key", () => {
    expect(changeModeTitleKey("session")).toBe("ui.sessionReview.title.session")
  })
})

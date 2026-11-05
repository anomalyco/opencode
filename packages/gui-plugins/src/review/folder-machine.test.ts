import { describe, expect, test } from "bun:test"
import type { FileDiffInfo } from "@opencode/client/promise"
import {
  INITIAL_REVIEW_FOLDER_STATE,
  REVIEW_FOLDER_RETRIES,
  reviewExpandedDiffs,
  reviewFolderCandidates,
  reviewFolderLabels,
  transitionReviewFolders,
  type ReviewFolderContext,
  type ReviewFolderEffect,
  type ReviewFolderEvent,
  type ReviewFolderSource,
  type ReviewFolderState,
} from "./folder-machine"

const git: ReviewFolderSource = {
  serverID: "local",
  root: "C:/repo",
  directory: "C:/repo",
  mode: "git",
  branch: "feature",
  defaultBranch: "dev",
}

const format = { more: (count: number) => `${count} · more not shown`, failed: "Couldn't load changes" }

function diff(file: string): FileDiffInfo {
  return { file, patch: "", additions: 0, deletions: 0, status: "added" }
}

// The entry a folder listing ends with when it stopped before listing every entry.
const more: FileDiffInfo = { ...diff(""), more: true }

const alpha = diff("src/alpha.ts")

function context(rows: readonly FileDiffInfo[], expanded: string[], input: Partial<ReviewFolderContext> = {}) {
  const value: ReviewFolderContext = { source: git, connected: true, rows, expanded: new Set(expanded), ...input }

  return { type: "context.changed", context: value } satisfies ReviewFolderEvent
}

function succeeded(folder: string, attempt: number, entries: readonly FileDiffInfo[]): ReviewFolderEvent {
  return { type: "fetch.succeeded", folder, attempt, entries }
}

function failed(folder: string, attempt: number): ReviewFolderEvent {
  return { type: "fetch.failed", folder, attempt }
}

function fetch(folder: string, attempt: number, source = git, delay = 0): ReviewFolderEffect {
  return { type: "fetch", folder, source, attempt, delay }
}

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: ReviewFolderState, ...events: ReviewFolderEvent[]) {
  return events.reduce<{ state: ReviewFolderState; effects: readonly ReviewFolderEffect[] }>(
    (result, event) => {
      const next = transitionReviewFolders(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

function files(rows: readonly FileDiffInfo[], state: ReviewFolderState) {
  return reviewExpandedDiffs(rows, state).map((entry) => entry.file)
}

describe("expanding an untracked folder", () => {
  test("loads its entries one level deep and labels it with their count", () => {
    const rows = [alpha, diff("tmp/")]
    const opened = play(INITIAL_REVIEW_FOLDER_STATE, context(rows, []), context(rows, ["tmp/"]))

    expect(opened.effects).toEqual([fetch("tmp/", 1)])
    expect(files(rows, opened.state)).toEqual(["src/alpha.ts", "tmp/"])

    const loaded = play(opened.state, succeeded("tmp/", 1, [diff("tmp/a.ts"), diff("tmp/b.ts")]))

    expect(files(rows, loaded.state)).toEqual(["src/alpha.ts", "tmp/", "tmp/a.ts", "tmp/b.ts"])
    expect(reviewFolderLabels(loaded.state, format)).toEqual(new Map([["tmp", "2"]]))
  })

  test("keeps a collapsed folder's entries and label without loading them again", () => {
    const rows = [diff("tmp/")]

    const loaded = play(
      INITIAL_REVIEW_FOLDER_STATE,
      context(rows, ["tmp/"]),
      succeeded("tmp/", 1, [diff("tmp/a.ts"), diff("tmp/b.ts"), more]),
    ).state

    const toggled = play(loaded, context(rows, []), context(rows, ["tmp/"]))

    expect(toggled.effects).toEqual([])
    // The listing's `more` sentinel is not a file; it only marks the label.
    expect(files(rows, toggled.state)).toEqual(["tmp/", "tmp/a.ts", "tmp/b.ts"])
    expect(reviewFolderLabels(toggled.state, format)).toEqual(new Map([["tmp", "2 · more not shown"]]))
  })

  test("loads a nested folder once its parent's entries list it", () => {
    const rows = [diff("outer/")]

    const parent = play(
      INITIAL_REVIEW_FOLDER_STATE,
      context(rows, ["outer/"]),
      succeeded("outer/", 1, [diff("outer/inner/")]),
    )

    expect(reviewFolderCandidates(rows, parent.state)).toEqual(["outer/", "outer/inner/"])

    const nested = play(
      parent.state,
      context(rows, ["outer/", "outer/inner/"]),
      succeeded("outer/inner/", 2, [diff("outer/inner/x.ts")]),
    )

    expect(nested.effects).toEqual([fetch("outer/inner/", 2)])
    expect(files(rows, nested.state)).toEqual(["outer/", "outer/inner/", "outer/inner/x.ts"])
  })
})

// Deleting an expanded untracked folder kept it open, so every refresh requested the deleted directory.
describe("a folder that leaves the changes", () => {
  test("is forgotten with its nested folders and never requested again", () => {
    const rows = [alpha, diff("tmp/")]

    const loaded = play(
      INITIAL_REVIEW_FOLDER_STATE,
      context(rows, ["tmp/"]),
      succeeded("tmp/", 1, [diff("tmp/sub/")]),
      context(rows, ["tmp/", "tmp/sub/"]),
    )

    expect(loaded.effects.at(-1)).toEqual(fetch("tmp/sub/", 2))

    // The tree still has the folders expanded, but the changes no longer list them.
    const deleted = play(loaded.state, context([alpha], ["tmp/", "tmp/sub/"]))

    expect(deleted.effects).toEqual([{ type: "abort", attempt: 2 }])
    expect(deleted.state).toMatchObject({ status: "active", folders: new Map() })
    expect(play(deleted.state, { type: "refresh" }, context([alpha], ["tmp/", "tmp/sub/"])).effects).toEqual([])
    expect(play(deleted.state, succeeded("tmp/sub/", 2, [])).state).toBe(deleted.state)
  })

  test("is dropped when its parent's new entries stop listing it", () => {
    const rows = [diff("outer/")]

    const nested = play(
      INITIAL_REVIEW_FOLDER_STATE,
      context(rows, ["outer/"]),
      succeeded("outer/", 1, [diff("outer/inner/")]),
      context(rows, ["outer/", "outer/inner/"]),
    ).state

    // New rows refresh the parent while the nested folder still loads.
    const refreshed = play(nested, context([...rows], ["outer/", "outer/inner/"]), succeeded("outer/", 3, []))

    expect(refreshed.effects).toEqual([fetch("outer/", 3), { type: "abort", attempt: 2 }])
    expect(reviewFolderCandidates(rows, refreshed.state)).toEqual(["outer/"])
  })
})

// A failed or hung folder load used to look like an empty folder, and opening it again did nothing.
describe("a folder that cannot load", () => {
  const rows = [diff("new-dir/")]

  test("retries a rejected load with backoff, then shows that it failed", () => {
    const opened = play(INITIAL_REVIEW_FOLDER_STATE, context(rows, ["new-dir/"])).state

    const retried = play(
      opened,
      ...Array.from({ length: REVIEW_FOLDER_RETRIES }, (_, index) => failed("new-dir/", index + 1)),
    )

    expect(retried.effects).toEqual([
      fetch("new-dir/", 2, git, 1000),
      fetch("new-dir/", 3, git, 2000),
      fetch("new-dir/", 4, git, 4000),
    ])
    expect(reviewFolderLabels(retried.state, format)).toEqual(new Map())

    const failure = play(retried.state, failed("new-dir/", 4))

    expect(failure.effects).toEqual([])
    expect(reviewFolderLabels(failure.state, format)).toEqual(new Map([["new-dir", "Couldn't load changes"]]))
    expect(files(rows, failure.state)).toEqual(["new-dir/"])
  })

  test("shows a timed-out load failed at once, and loads it when collapsed and expanded again", () => {
    const failure = play(INITIAL_REVIEW_FOLDER_STATE, context(rows, ["new-dir/"]), {
      type: "fetch.timed-out",
      folder: "new-dir/",
      attempt: 1,
    }).state

    expect(reviewFolderLabels(failure, format)).toEqual(new Map([["new-dir", "Couldn't load changes"]]))

    const collapsed = play(failure, context(rows, []))

    expect(reviewFolderLabels(collapsed.state, format)).toEqual(new Map())

    const reopened = play(
      collapsed.state,
      context(rows, ["new-dir/"]),
      succeeded("new-dir/", 2, [diff("new-dir/a.ts")]),
    )

    expect(reopened.effects).toEqual([fetch("new-dir/", 2)])
    expect(files(rows, reopened.state)).toEqual(["new-dir/", "new-dir/a.ts"])
    expect(reviewFolderLabels(reopened.state, format)).toEqual(new Map([["new-dir", "1"]]))
  })

  test("a folder collapsed while it loads forgets the failure", () => {
    const state = play(
      INITIAL_REVIEW_FOLDER_STATE,
      context(rows, ["new-dir/"]),
      context(rows, []),
      failed("new-dir/", 1),
    )

    expect(state.effects).toEqual([fetch("new-dir/", 1)])
    expect(state.state).toMatchObject({ folders: new Map() })
  })

  test("Try again, a reconnect and new changes retry an expanded failed folder", () => {
    const failure = play(INITIAL_REVIEW_FOLDER_STATE, context(rows, ["new-dir/"]), {
      type: "fetch.timed-out",
      folder: "new-dir/",
      attempt: 1,
    }).state

    expect(play(failure, { type: "retry" }).effects).toEqual([fetch("new-dir/", 2)])
    expect(play(failure, context([...rows], ["new-dir/"])).effects).toEqual([fetch("new-dir/", 2)])

    const offline = play(failure, context(rows, ["new-dir/"], { connected: false }))

    expect(offline.state).toMatchObject({ folders: new Map() })
    expect(play(offline.state, { type: "retry" }).effects).toEqual([])
    expect(play(offline.state, context(rows, ["new-dir/"])).effects).toEqual([fetch("new-dir/", 2)])
  })
})

// Switching mode or directory reset the folders in an effect after the diffs had already been derived from them.
describe("another source", () => {
  const rows = [diff("tmp/")]

  test("drops the folders and requests in the same transition and ignores their late answers", () => {
    const loading = play(INITIAL_REVIEW_FOLDER_STATE, context(rows, ["tmp/"])).state
    const branch = { ...git, mode: "branch" as const }
    const switched = play(loading, context(rows, ["tmp/"], { source: branch }))

    expect(switched.effects).toEqual([{ type: "abort", attempt: 1 }, fetch("tmp/", 2, branch)])
    expect(play(switched.state, succeeded("tmp/", 1, [diff("tmp/stale.ts")])).state).toBe(switched.state)

    const moved = play(switched.state, context(rows, ["tmp/"], { source: { ...branch, directory: "C:/repo/sub" } }))

    expect(moved.effects).toEqual([
      { type: "abort", attempt: 2 },
      fetch("tmp/", 3, { ...branch, directory: "C:/repo/sub" }),
    ])
  })

  test("a turn's changes stop folder loading", () => {
    const loaded = play(INITIAL_REVIEW_FOLDER_STATE, context(rows, ["tmp/"]), succeeded("tmp/", 1, [diff("tmp/a.ts")]))
    const turn = play(loaded.state, context(rows, ["tmp/"], { source: undefined }))

    expect(turn.state).toEqual({ status: "inactive", issued: 1 })
    expect(files(rows, turn.state)).toEqual(["tmp/"])
    expect(play(turn.state, failed("tmp/", 1)).state).toBe(turn.state)
  })
})

describe("refreshing", () => {
  const rows = [diff("tmp/")]

  test("a change during the first load loads once more with the first answer shown", () => {
    const state = play(
      INITIAL_REVIEW_FOLDER_STATE,
      context(rows, ["tmp/"]),
      { type: "refresh" },
      { type: "refresh" },
      succeeded("tmp/", 1, [diff("tmp/a.ts")]),
    )

    expect(state.effects).toEqual([fetch("tmp/", 1), fetch("tmp/", 2)])
    expect(files(rows, state.state)).toEqual(["tmp/", "tmp/a.ts"])

    const failedRefresh = play(state.state, failed("tmp/", 2))

    expect(failedRefresh.effects).toEqual([])
    expect(files(rows, failedRefresh.state)).toEqual(["tmp/", "tmp/a.ts"])
  })

  test("new changes reload a loaded folder, collapsed or not, and a disconnect keeps its entries", () => {
    const loaded = play(INITIAL_REVIEW_FOLDER_STATE, context(rows, ["tmp/"]), succeeded("tmp/", 1, [diff("tmp/a.ts")]))
    const next = [...rows]
    const reloaded = play(loaded.state, context(next, []))

    expect(reloaded.effects).toEqual([fetch("tmp/", 2)])

    const offline = play(reloaded.state, context(next, [], { connected: false }))

    expect(offline.effects).toEqual([{ type: "abort", attempt: 2 }])
    expect(files(next, offline.state)).toEqual(["tmp/", "tmp/a.ts"])
    expect(play(offline.state, context(next, [])).effects).toEqual([fetch("tmp/", 3)])
  })
})

test("disposal aborts every request and ignores later events", () => {
  const rows = [diff("a/"), diff("b/")]
  const loading = play(INITIAL_REVIEW_FOLDER_STATE, context(rows, ["a/", "b/"]))

  expect(loading.effects).toEqual([fetch("a/", 1), fetch("b/", 2)])

  const disposed = play(loading.state, { type: "disposed" })

  expect(disposed.effects).toEqual([
    { type: "abort", attempt: 1 },
    { type: "abort", attempt: 2 },
  ])

  for (const event of [succeeded("a/", 1, []), context(rows, []), { type: "retry" }] satisfies ReviewFolderEvent[])
    expect(transitionReviewFolders(disposed.state, event).state).toBe(disposed.state)
})

import { describe, expect, test } from "bun:test"
import type { FileNode } from "@/runtime/server/types"
import {
  canRefreshDirectory,
  createFileTreeState,
  DIRECTORY_LIST_TIMEOUT_MS,
  isDirectoryLoaded,
  isDirectoryLoading,
  selectDirectoryChildren,
  selectDirectoryError,
  transitionFileTree,
  type FileTreeEffect,
  type FileTreeEvent,
  type FileTreeState,
} from "./tree-machine"

// The server ends directory paths with the platform separator (`FileSystem.list` in packages/core/src/filesystem.ts).
const file = (path: string): FileNode => ({
  path,
  type: "file",
  name: path.split("/").at(-1) ?? path,
  absolute: `/repo/${path}`,
  ignored: false,
})

const directory = (path: string): FileNode => ({
  path: `${path}/`,
  type: "directory",
  name: path.split("/").at(-1) ?? path,
  absolute: `/repo/${path}`,
  ignored: false,
})

function replay(events: readonly FileTreeEvent[], state = createFileTreeState()) {
  return events.reduce<{ state: FileTreeState; effects: FileTreeEffect[] }>(
    (current, event) => {
      const result = transitionFileTree(current.state, event)

      return { state: result.state, effects: [...current.effects, ...result.effects] }
    },
    { state, effects: [] },
  )
}

const dir = (state: FileTreeState, path: string) => (state.status === "active" ? state.dirs[path] : undefined)

const paths = (state: FileTreeState, path: string) => selectDirectoryChildren(state, path).map((node) => node.path)

const list = (path: string, attempt: number): FileTreeEffect => ({
  type: "list",
  dir: path,
  attempt,
  timeoutMs: DIRECTORY_LIST_TIMEOUT_MS,
})

describe("file tree machine", () => {
  test("a forced reload during a listing runs one follow-up listing instead of joining it", () => {
    const started = replay([{ type: "list.requested", dir: "src", force: false }])
    expect(started.effects).toEqual([list("src", 1)])

    const queued = replay(
      [
        { type: "list.requested", dir: "src", force: true },
        { type: "list.requested", dir: "src", force: true },
      ],
      started.state,
    )

    expect(queued.effects).toEqual([])
    expect(dir(queued.state, "src")).toMatchObject({ status: "loading", attempt: 1, dirty: true })
    expect(transitionFileTree(queued.state, { type: "list.requested", dir: "src", force: true }).state).toBe(
      queued.state,
    )

    // The first read happened before `b.ts` was created: its result shows at once, and the follow-up reads again.
    const first = transitionFileTree(queued.state, {
      type: "list.loaded",
      dir: "src",
      attempt: 1,
      nodes: [file("src/a.ts")],
    })

    expect(paths(first.state, "src")).toEqual(["src/a.ts"])
    expect(dir(first.state, "src")).toMatchObject({ status: "refreshing", attempt: 2, dirty: false })
    expect(first.effects).toEqual([list("src", 2)])

    const second = transitionFileTree(first.state, {
      type: "list.loaded",
      dir: "src",
      attempt: 2,
      nodes: [file("src/a.ts"), file("src/b.ts")],
    })

    expect(paths(second.state, "src")).toEqual(["src/a.ts", "src/b.ts"])
    expect(dir(second.state, "src")?.status).toBe("ready")
    expect(second.effects).toEqual([])
  })

  test("a watcher change during a directory's first listing can reload it", () => {
    const loading = replay([{ type: "dir.expanded", dir: "src", list: true }]).state

    expect(canRefreshDirectory(loading, "src")).toBe(true)
    expect(canRefreshDirectory(loading, "lib")).toBe(false)

    const failed = replay(
      [
        { type: "list.requested", dir: "lib", force: false },
        { type: "list.failed", dir: "lib", attempt: 2, error: "boom" },
      ],
      loading,
    ).state

    expect(canRefreshDirectory(failed, "lib")).toBe(false)

    const queued = transitionFileTree(loading, { type: "list.requested", dir: "src", force: true })

    const loaded = transitionFileTree(queued.state, {
      type: "list.loaded",
      dir: "src",
      attempt: 1,
      nodes: [file("src/a.ts")],
    })

    expect(loaded.effects).toEqual([list("src", 2)])
  })

  test("results from before a workspace reset never land in the new workspace", () => {
    const before = replay([{ type: "list.requested", dir: "", force: false }]).state
    const reset = transitionFileTree(before, { type: "reset" }).state
    expect(reset).toMatchObject({ epoch: 1, issued: 1 })

    const after = transitionFileTree(reset, { type: "list.requested", dir: "", force: false })
    expect(after.effects).toEqual([list("", 2)])

    const late: FileTreeEvent[] = [
      { type: "list.loaded", dir: "", attempt: 1, nodes: [file("a.ts")] },
      { type: "list.failed", dir: "", attempt: 1, error: "gone" },
      { type: "list.timed-out", dir: "", attempt: 1 },
    ]

    late.forEach((event) => {
      const result = transitionFileTree(after.state, event)
      expect(result.state).toBe(after.state)
      expect(result.effects).toEqual([])
    })
  })

  test("a failed reload keeps the listed entries without an error, and a failed first listing reports it", () => {
    const ready = replay([
      { type: "list.requested", dir: "src", force: false },
      { type: "list.loaded", dir: "src", attempt: 1, nodes: [file("src/a.ts")] },
    ]).state

    const reloaded = replay(
      [
        { type: "list.requested", dir: "src", force: true },
        { type: "list.failed", dir: "src", attempt: 2, error: "boom" },
      ],
      ready,
    )

    const entry = dir(reloaded.state, "src")
    expect(entry?.status).toBe("ready")
    expect(isDirectoryLoaded(entry)).toBe(true)
    expect(isDirectoryLoading(entry)).toBe(false)
    expect(selectDirectoryError(entry)).toBeUndefined()
    expect(paths(reloaded.state, "src")).toEqual(["src/a.ts"])
    expect(reloaded.effects).toEqual([list("src", 2)])

    const failed = replay([
      { type: "list.requested", dir: "src", force: false },
      { type: "list.failed", dir: "src", attempt: 1, error: "boom" },
    ])

    expect(isDirectoryLoaded(dir(failed.state, "src"))).toBe(false)
    expect(selectDirectoryError(dir(failed.state, "src"))).toBe("boom")
    expect(failed.effects.at(-1)).toEqual({ type: "notify.error", message: "boom" })

    // Opening the directory again retries it.
    expect(transitionFileTree(failed.state, { type: "dir.expanded", dir: "src", list: true }).effects).toEqual([
      list("src", 2),
    ])
  })

  test.each([
    ["removed", [file("src/a.ts")]],
    ["replaced by a file", [file("src/a.ts"), file("src/sub")]],
  ])("a subdirectory %s drops its entries and its listing state", (_, next) => {
    const loaded = replay([
      { type: "list.requested", dir: "src", force: false },
      { type: "list.loaded", dir: "src", attempt: 1, nodes: [file("src/a.ts"), directory("src/sub")] },
      { type: "dir.expanded", dir: "src/sub", list: true },
      { type: "list.loaded", dir: "src/sub", attempt: 2, nodes: [file("src/sub/old.ts"), directory("src/sub/deep")] },
      { type: "dir.expanded", dir: "src/sub/deep", list: true },
    ]).state

    const refreshed = replay(
      [
        { type: "list.requested", dir: "src", force: true },
        { type: "list.loaded", dir: "src", attempt: 4, nodes: next },
      ],
      loaded,
    ).state

    expect(refreshed.status === "active" && Object.keys(refreshed.dirs).sort()).toEqual(["", "src"])
    expect(refreshed.status === "active" && Object.keys(refreshed.nodes).sort()).toEqual(
      next.map((node) => node.path).sort(),
    )

    // The pruned in-flight listing of `src/sub/deep` lands nowhere.
    expect(
      transitionFileTree(refreshed, { type: "list.loaded", dir: "src/sub/deep", attempt: 3, nodes: [] }).state,
    ).toBe(refreshed)

    // A re-created directory lists again instead of showing as empty.
    expect(transitionFileTree(refreshed, { type: "dir.expanded", dir: "src/sub", list: true }).effects).toEqual([
      list("src/sub", 5),
    ])
  })

  test("a timeout ends the listing: a first listing fails, a reload keeps its entries, a queued reload runs", () => {
    const loading = replay([{ type: "list.requested", dir: "src", force: false }]).state
    const failed = transitionFileTree(loading, { type: "list.timed-out", dir: "src", attempt: 1 })
    expect(dir(failed.state, "src")).toEqual({ status: "failed", expanded: false, error: undefined })
    expect(failed.effects).toEqual([{ type: "notify.error", message: "" }])

    const refreshing = replay(
      [
        { type: "list.loaded", dir: "src", attempt: 1, nodes: [file("src/a.ts")] },
        { type: "list.requested", dir: "src", force: true },
      ],
      loading,
    ).state

    const kept = transitionFileTree(refreshing, { type: "list.timed-out", dir: "src", attempt: 2 })
    expect(dir(kept.state, "src")).toEqual({ status: "ready", expanded: false, children: ["src/a.ts"] })
    expect(kept.effects).toEqual([])

    const queued = transitionFileTree(refreshing, { type: "list.requested", dir: "src", force: true }).state
    const retried = transitionFileTree(queued, { type: "list.timed-out", dir: "src", attempt: 2 })
    expect(dir(retried.state, "src")).toMatchObject({ status: "refreshing", attempt: 3, dirty: false })
    expect(retried.effects).toEqual([list("src", 3)])
  })

  test("expanding and collapsing keep the listing and list only when asked", () => {
    const initial = createFileTreeState()

    const filtered = transitionFileTree(initial, { type: "dir.expanded", dir: "src", list: false })
    expect(dir(filtered.state, "src")).toEqual({ status: "idle", expanded: true })
    expect(filtered.effects).toEqual([])
    expect(transitionFileTree(filtered.state, { type: "dir.expanded", dir: "src", list: false }).state).toBe(
      filtered.state,
    )

    const collapsed = transitionFileTree(initial, { type: "dir.collapsed", dir: "src" }).state
    expect(dir(collapsed, "src")).toEqual({ status: "idle", expanded: false })
    expect(transitionFileTree(collapsed, { type: "dir.collapsed", dir: "src" }).state).toBe(collapsed)

    const ready = replay(
      [
        { type: "dir.expanded", dir: "src", list: true },
        { type: "list.loaded", dir: "src", attempt: 1, nodes: [file("src/a.ts")] },
        { type: "dir.collapsed", dir: "src" },
      ],
      initial,
    ).state

    expect(paths(ready, "src")).toEqual(["src/a.ts"])

    const reopened = transitionFileTree(ready, { type: "dir.expanded", dir: "src", list: true })
    expect(dir(reopened.state, "src")).toMatchObject({ status: "ready", expanded: true })
    expect(reopened.effects).toEqual([])
    expect(transitionFileTree(reopened.state, { type: "list.requested", dir: "src", force: false }).state).toBe(
      reopened.state,
    )
  })

  test("an untouched tree ignores a reset, and a disposed tree ignores everything", () => {
    const initial = createFileTreeState()
    expect(transitionFileTree(initial, { type: "reset" }).state).toBe(initial)

    const loading = replay([{ type: "list.requested", dir: "src", force: false }]).state
    const disposed = transitionFileTree(loading, { type: "disposed" }).state
    expect(disposed).toEqual({ status: "disposed" })
    expect(canRefreshDirectory(disposed, "src")).toBe(false)

    const events: FileTreeEvent[] = [
      { type: "list.loaded", dir: "src", attempt: 1, nodes: [file("src/a.ts")] },
      { type: "list.failed", dir: "src", attempt: 1, error: "boom" },
      { type: "list.requested", dir: "src", force: true },
      { type: "reset" },
    ]

    events.forEach((event) => {
      const result = transitionFileTree(disposed, event)
      expect(result.state).toBe(disposed)
      expect(result.effects).toEqual([])
    })
  })
})

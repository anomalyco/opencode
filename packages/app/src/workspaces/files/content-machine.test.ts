import { describe, expect, test } from "bun:test"
import type { FileContent } from "@opencode/plugin/gui"
import {
  createFileContentState,
  selectFileLoading,
  selectFileMissing,
  selectFileState,
  transitionFileContent,
  type FileContentEffect,
  type FileContentEvent,
  type FileContentState,
} from "./content-machine"

const text = (content: string): FileContent => ({ type: "text", content })

const before = text("before")

const after = text("after")

const requested = (force = false, silent = false, path = "a.ts"): FileContentEvent => ({
  type: "load.requested",
  path,
  force,
  silent,
})

const succeeded = (attempt: number, content: FileContent, path = "a.ts"): FileContentEvent => ({
  type: "load.succeeded",
  path,
  attempt,
  content,
})

const failed = (attempt: number, error = "500"): FileContentEvent => ({
  type: "load.failed",
  path: "a.ts",
  attempt,
  error,
})

const missing = (attempt: number, opened = false): FileContentEvent => ({
  type: "load.missing",
  path: "a.ts",
  attempt,
  error: "not found",
  opened,
})

const timedOut = (attempt: number): FileContentEvent => ({
  type: "load.timed-out",
  path: "a.ts",
  attempt,
  error: "Request failed",
})

function replay(events: FileContentEvent[], state = createFileContentState("/repo")) {
  return events.reduce<{ state: FileContentState; effects: readonly FileContentEffect[] }>(
    (step, event) => transitionFileContent(step.state, event),
    { state, effects: [] },
  )
}

function entry(state: FileContentState, path = "a.ts") {
  return state.status === "active" ? state.files[path] : undefined
}

function view(state: FileContentState, path = "a.ts") {
  return selectFileState(path, entry(state, path))
}

const read = (attempt: number, path = "a.ts", directory = "/repo"): FileContentEffect => ({
  type: "read",
  directory,
  path,
  attempt,
})

describe("file content machine", () => {
  // A watcher change during a read used to join that read, so the tab kept the bytes from before the change.
  test("a forced load during a read reads again after it", () => {
    const joined = replay([requested(), requested(true, true)])

    expect(joined.effects).toEqual([])
    expect(entry(joined.state)).toEqual({ status: "loading", attempt: 1, silent: false, rerun: true })

    const first = transitionFileContent(joined.state, succeeded(1, before))

    expect(first.effects).toEqual([{ type: "cache.store", path: "a.ts", content: before }, read(2)])
    expect(view(first.state)).toMatchObject({ status: "refreshing", loaded: true, loading: true, content: before })

    const second = transitionFileContent(first.state, succeeded(2, after))

    expect(second.effects).toEqual([
      { type: "cache.store", path: "a.ts", content: after },
      { type: "settle", path: "a.ts" },
    ])
    expect(entry(second.state)).toEqual({ status: "ready", content: after, stale: false })
  })

  test("a failure an outdating change follows is not reported and reads again", () => {
    const loaded = replay([requested(), succeeded(1, before), requested(true), requested(true, true)])
    const step = transitionFileContent(loaded.state, failed(2))

    expect(step.effects).toEqual([read(3)])
    expect(entry(step.state)).toEqual({
      status: "refreshing",
      content: before,
      attempt: 3,
      silent: false,
      rerun: false,
    })
  })

  // A failed forced reload used to leave `loaded` and `error` together, and the next plain load returned early.
  test("a failed refresh keeps the content without an error and the next plain load reads again", () => {
    const step = replay([requested(), succeeded(1, before), requested(true), failed(2)])

    expect(step.effects).toEqual([
      { type: "settle", path: "a.ts" },
      { type: "toast", message: "500" },
    ])
    expect(view(step.state)).toEqual({
      status: "ready",
      path: "a.ts",
      name: "a.ts",
      loaded: true,
      loading: false,
      notFound: false,
      content: before,
    })

    const retry = transitionFileContent(step.state, requested(false, true))

    expect(retry.effects).toEqual([read(3)])
    expect(entry(retry.state)).toEqual({
      status: "refreshing",
      content: before,
      attempt: 3,
      silent: true,
      rerun: false,
    })
  })

  test("a plain load of loaded content does nothing", () => {
    const loaded = replay([requested(), succeeded(1, before)]).state

    expect(transitionFileContent(loaded, requested()).state).toBe(loaded)
  })

  // Reloading a missing file used to keep `notFound` beside `loading`.
  test("reloading a missing file shows it loading, not missing", () => {
    const gone = replay([requested(), missing(1)]).state

    expect(selectFileMissing(entry(gone))).toBe(true)
    expect(view(gone)).toMatchObject({ status: "missing", notFound: true, loading: false })

    const retry = transitionFileContent(gone, requested())

    expect(retry.effects).toEqual([read(2)])
    expect(selectFileMissing(entry(retry.state))).toBe(false)
    expect(view(retry.state)).toMatchObject({ status: "loading", notFound: false, loading: true, loaded: false })
  })

  test.each([
    { name: "toasts when no tab shows it", silent: false, opened: false, toast: true },
    { name: "stays quiet when its tab shows it", silent: false, opened: true, toast: false },
    { name: "stays quiet for a silent load", silent: true, opened: false, toast: false },
  ])("a file deleted during a refresh drops its content and $name", (row) => {
    const step = replay([requested(), succeeded(1, before), requested(true, row.silent), missing(2, row.opened)])

    const toast: FileContentEffect[] = row.toast ? [{ type: "toast", message: "not found" }] : []

    expect(entry(step.state)).toEqual({ status: "missing", error: "not found" })
    expect(step.effects).toEqual([{ type: "cache.remove", path: "a.ts" }, { type: "settle", path: "a.ts" }, ...toast])
  })

  test("a plain load joins a silent read and makes its failure reported", () => {
    const joined = replay([requested(false, true), requested()])

    expect(joined.effects).toEqual([])
    expect(entry(joined.state)).toEqual({ status: "loading", attempt: 1, silent: false, rerun: false })

    const step = transitionFileContent(joined.state, failed(1))

    expect(entry(step.state)).toEqual({ status: "error", error: "500" })
    expect(step.effects).toEqual([
      { type: "settle", path: "a.ts" },
      { type: "toast", message: "500" },
    ])
  })

  test("a timed-out first load fails, aborts its read and ignores its late reply", () => {
    const step = replay([requested(), timedOut(1)])

    expect(entry(step.state)).toEqual({ status: "error", error: "Request failed" })
    expect(step.effects).toEqual([
      { type: "abort", path: "a.ts", attempt: 1 },
      { type: "settle", path: "a.ts" },
      { type: "toast", message: "Request failed" },
    ])
    expect(transitionFileContent(step.state, succeeded(1, before)).state).toBe(step.state)
    expect(transitionFileContent(step.state, failed(1)).state).toBe(step.state)
  })

  test("a timed-out refresh keeps its content and ends the cycle even with a change pending", () => {
    const step = replay([requested(), succeeded(1, before), requested(true, true), requested(true, true), timedOut(2)])

    expect(entry(step.state)).toEqual({ status: "ready", content: before, stale: true })
    expect(step.effects).toEqual([
      { type: "abort", path: "a.ts", attempt: 2 },
      { type: "settle", path: "a.ts" },
    ])
  })

  test("eviction forgets a loaded file and steps a refresh down to a first load", () => {
    const loaded = replay([
      requested(),
      succeeded(1, before),
      requested(false, false, "b.ts"),
      succeeded(2, after, "b.ts"),
    ])

    const refreshing = transitionFileContent(loaded.state, requested(true, true, "b.ts")).state
    const step = transitionFileContent(refreshing, { type: "cache.evicted", paths: ["a.ts", "b.ts", "c.ts"] })

    expect(step.effects).toEqual([])
    expect(view(step.state)).toBeUndefined()
    expect(entry(step.state, "b.ts")).toEqual({ status: "loading", attempt: 3, silent: true, rerun: false })
    expect(selectFileLoading(entry(step.state, "b.ts"))).toBe(true)

    const settled = transitionFileContent(step.state, succeeded(3, before, "b.ts"))

    expect(entry(settled.state, "b.ts")).toEqual({ status: "ready", content: before, stale: false })
  })

  test("a directory change drops every file and rejects replies to the earlier directory", () => {
    const pending = replay([requested(), succeeded(1, before), requested(false, false, "b.ts")]).state
    const moved = transitionFileContent(pending, { type: "scope.changed", directory: "/other" })

    expect(moved.state).toEqual({ status: "active", directory: "/other", issued: 2, files: {} })
    expect(moved.effects).toEqual([{ type: "abort.all" }, { type: "cache.reset" }])

    const reloading = transitionFileContent(moved.state, requested(false, false, "b.ts"))

    expect(reloading.effects).toEqual([read(3, "b.ts", "/other")])
    expect(transitionFileContent(reloading.state, succeeded(2, before, "b.ts")).state).toBe(reloading.state)
    expect(transitionFileContent(moved.state, { type: "scope.changed", directory: "/other" }).state).toBe(moved.state)
  })

  test("disposal aborts everything once and ignores every later event", () => {
    const pending = replay([requested()]).state
    const disposed = transitionFileContent(pending, { type: "disposed" })

    expect(disposed.state).toEqual({ status: "disposed" })
    expect(disposed.effects).toEqual([{ type: "abort.all" }, { type: "cache.reset" }])

    const events: FileContentEvent[] = [
      { type: "disposed" },
      requested(true),
      succeeded(1, before),
      { type: "scope.changed", directory: "/other" },
    ]

    events.forEach((event) => {
      const step = transitionFileContent(disposed.state, event)

      expect(step.state).toBe(disposed.state)
      expect(step.effects).toEqual([])
    })
  })

  const loading = replay([requested()]).state
  const ready = replay([requested(), succeeded(1, before)]).state
  const refreshing = replay([requested(), succeeded(1, before), requested(true)]).state

  test.each<{ name: string; state: FileContentState; event: FileContentEvent }>([
    { name: "an empty path", state: ready, event: requested(true, false, "") },
    { name: "a reply to an older read", state: refreshing, event: succeeded(1, after) },
    { name: "a reply for a file never requested", state: ready, event: succeeded(1, after, "b.ts") },
    { name: "a reply once the file is loaded", state: ready, event: failed(1) },
    { name: "a repeated silent load", state: loading, event: requested(false, true) },
    { name: "a repeated plain load", state: loading, event: requested() },
    { name: "eviction of an unknown file", state: ready, event: { type: "cache.evicted", paths: ["b.ts"] } },
    { name: "eviction of a first load", state: loading, event: { type: "cache.evicted", paths: ["a.ts"] } },
    { name: "the same directory", state: ready, event: { type: "scope.changed", directory: "/repo" } },
  ])("ignores $name", (row) => {
    const step = transitionFileContent(row.state, row.event)

    expect(step.state).toBe(row.state)
    expect(step.effects).toEqual([])
  })
})

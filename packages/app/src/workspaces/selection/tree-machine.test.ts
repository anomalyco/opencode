import { expect, test } from "bun:test"
import { pickerMode } from "./domain"
import {
  createPickerTreeState,
  hasPickerGitRepo,
  pickerTreeView,
  transitionPickerTree,
  type PickerNode,
  type PickerTreeEvent,
  type PickerTreeState,
  type PickerTreeTransition,
} from "./tree-machine"

const HOME = "/home/user"

const policy = pickerMode("directory")

const folder = (name: string): PickerNode => ({ name, type: "directory" })

const navigate = (path: string, located = true): PickerTreeEvent => ({
  type: "navigate",
  path,
  home: HOME,
  fallback: HOME,
  located,
})

const choose = (path: string, fromInput = false): PickerTreeEvent => ({
  type: "directory.chosen",
  path,
  home: HOME,
  fallback: HOME,
  located: true,
  fromInput,
})

function run(events: PickerTreeEvent[], state = createPickerTreeState(), mode = policy) {
  return events.reduce<PickerTreeTransition>((current, event) => transitionPickerTree(current.state, event, mode), {
    state,
    effects: [],
  })
}

// Opens `root` and lists it. Its folders preload with attempts 2, 3, ... in order.
function ready(root: string, nodes: PickerNode[]) {
  return run([navigate(root), { type: "dir.loaded", dir: "", attempt: 1, nodes }]).state
}

function dirs(state: PickerTreeState) {
  return state.status === "ready" ? state.dirs : {}
}

test("a child folder that fails leaves the root readable and retries on its next expand", () => {
  const state = ready(HOME, [folder("work")])

  for (const type of ["dir.failed", "dir.timed-out"] as const) {
    const failed = run([{ type, dir: "work", attempt: 2 }], state)
    const retried = run([{ type: "dir.expanded", dir: "work/" }], failed.state)

    expect(pickerTreeView(failed.state, policy)).toMatchObject({ error: false, loading: false, result: HOME })
    expect(dirs(failed.state).work).toEqual({ status: "failed" })
    expect(retried.effects).toEqual([
      { type: "list", root: HOME, dir: "work", attempt: 3, priority: "user", timeoutMs: 30_000 },
    ])
  }
})

test("a root that fails shows the read error and cannot be confirmed, whatever settles later", () => {
  const failed = run([navigate(HOME), { type: "dir.failed", dir: "", attempt: 1 }])

  const late = run(
    [
      { type: "dir.loaded", dir: "work", attempt: 2, nodes: [] },
      { type: "dir.expanded", dir: "work" },
    ],
    failed.state,
  )

  expect(failed.effects).toEqual([{ type: "queue.reset" }])
  expect(pickerTreeView(failed.state, policy)).toMatchObject({ error: true, loading: false, result: undefined })
  expect(late.state).toBe(failed.state)
  expect(
    pickerTreeView(run([navigate(HOME), { type: "dir.timed-out", dir: "", attempt: 1 }]).state, policy).error,
  ).toBeTrue()
})

test("a newer choice wins over a reveal still waiting on its ancestors", () => {
  const state = ready(HOME, [folder("work"), folder("fast-repo")])
  const revealing = run([choose(`${HOME}/work/slow/repo-a`)], state)

  expect(revealing.effects).toEqual([{ type: "promote", attempt: 2 }])

  for (const newer of [
    choose(`${HOME}/fast-repo`),
    { type: "tree.selected", path: "fast-repo/" } as const,
    { type: "selection.cleared" } as const,
  ]) {
    const chosen = run([newer], revealing.state)
    const settled = run([{ type: "dir.loaded", dir: "work", attempt: 2, nodes: [folder("slow")] }], chosen.state)

    expect(settled.effects).toEqual([{ type: "tree.add", paths: ["work/slow/"] }])
    expect(pickerTreeView(settled.state, policy).selected).toBe(pickerTreeView(chosen.state, policy).selected)
    expect(settled.state).toMatchObject({ status: "ready", root: HOME, reveal: undefined })
  }
})

test("a reveal expands each listed ancestor, then selects the folder and lists it when typed", () => {
  const state = ready(HOME, [folder("work")])
  const revealing = run([choose(`${HOME}/work/slow/repo-a`, true)], state)
  const work = run([{ type: "dir.loaded", dir: "work", attempt: 2, nodes: [folder("slow")] }], revealing.state)
  const slow = run([{ type: "dir.loaded", dir: "work/slow", attempt: 3, nodes: [folder("repo-a")] }], work.state)

  expect(work.effects).toEqual([
    { type: "tree.add", paths: ["work/slow/"] },
    { type: "tree.expand", dir: "work" },
    { type: "list", root: HOME, dir: "work/slow", attempt: 3, priority: "user", timeoutMs: 30_000 },
  ])
  expect(slow.effects).toEqual([
    { type: "tree.add", paths: ["work/slow/repo-a/"] },
    { type: "tree.expand", dir: "work/slow" },
    { type: "tree.select", entry: "work/slow/repo-a/" },
    { type: "tree.expand", dir: "work/slow/repo-a" },
    { type: "list", root: HOME, dir: "work/slow/repo-a", attempt: 4, priority: "user", timeoutMs: 30_000 },
  ])
  expect(pickerTreeView(slow.state, policy)).toMatchObject({
    selected: `${HOME}/work/slow/repo-a`,
    result: `${HOME}/work/slow/repo-a`,
  })
})

test("a revealed folder the listings do not show opens as the root instead", () => {
  const state = ready(HOME, [folder("work")])
  const revealing = run([choose(`${HOME}/work/missing`)], state)
  const listed = run([{ type: "dir.loaded", dir: "work", attempt: 2, nodes: [] }], revealing.state)
  const failed = run([{ type: "dir.failed", dir: "work", attempt: 2 }], revealing.state)

  for (const settled of [listed, failed]) {
    expect(settled.state).toMatchObject({ status: "loading", root: `${HOME}/work/missing`, attempt: 3 })
    expect(settled.effects).toEqual([
      { type: "queue.reset" },
      { type: "tree.reset" },
      { type: "list", root: `${HOME}/work/missing`, dir: "", attempt: 3, priority: "user", timeoutMs: 30_000 },
    ])
  }
})

test("choosing the root clears the selection", () => {
  const state = run([{ type: "tree.selected", path: "work/" }], ready(HOME, [folder("work")])).state
  const chosen = run([choose(HOME)], state)

  expect(pickerTreeView(state, policy).selected).toBe(`${HOME}/work`)
  expect(chosen.effects).toEqual([{ type: "tree.clear-selection" }])
  expect(pickerTreeView(chosen.state, policy)).toMatchObject({ selected: "", result: HOME })
})

test("a new root drops the previous root's listings and selection", () => {
  const state = run([{ type: "tree.selected", path: "work/" }], ready(HOME, [folder("work")])).state
  const moved = run([navigate("/srv")], state)

  expect(moved.state).toMatchObject({ status: "loading", root: "/srv", attempt: 3 })
  expect(moved.effects).toEqual([
    { type: "queue.reset" },
    { type: "tree.reset" },
    { type: "list", root: "/srv", dir: "", attempt: 3, priority: "user", timeoutMs: 30_000 },
  ])
  expect(pickerTreeView(moved.state, policy)).toMatchObject({ selected: "", loading: true, result: undefined })

  for (const late of [
    { type: "dir.loaded", dir: "", attempt: 1, nodes: [] },
    { type: "dir.loaded", dir: "work", attempt: 2, nodes: [] },
    { type: "dir.failed", dir: "", attempt: 1 },
    { type: "dir.timed-out", dir: "work", attempt: 2 },
  ] as const) {
    expect(run([late], moved.state).state).toBe(moved.state)
  }
})

test("a folder of home outside the root opens home with that folder selected", () => {
  const state = ready("/srv", [])
  const chosen = run([choose(`${HOME}/notes`)], state)
  const listed = run([{ type: "dir.loaded", dir: "", attempt: 2, nodes: [folder("notes")] }], chosen.state)

  expect(chosen.state).toMatchObject({ status: "loading", root: HOME, selectChild: `${HOME}/notes` })
  expect(listed.effects).toEqual([
    { type: "tree.add", paths: ["notes/"] },
    { type: "tree.select", entry: "notes/" },
    { type: "list", root: HOME, dir: "notes", attempt: 3, priority: "background", timeoutMs: 30_000 },
  ])
  expect(pickerTreeView(listed.state, policy).selected).toBe(`${HOME}/notes`)
})

test("without a dialog location the picker resolves one, and a failure or timeout ends in the read error", () => {
  const requested = run([{ type: "location.requested" }])

  expect(requested.effects).toEqual([{ type: "resolve-location", attempt: 1, timeoutMs: 30_000 }])
  expect(pickerTreeView(requested.state, policy).loading).toBeTrue()
  expect(run([{ type: "location.requested" }], requested.state).state).toBe(requested.state)
  expect(run([{ type: "location.failed", attempt: 9 }], requested.state).state).toBe(requested.state)

  for (const event of [
    { type: "location.failed", attempt: 1 },
    { type: "location.timed-out", attempt: 1 },
    { type: "location.resolved", attempt: 1, directory: undefined },
  ] as const) {
    const failed = run([event], requested.state)

    expect(pickerTreeView(failed.state, policy)).toMatchObject({ loading: false, error: true })

    const retried = run([navigate(HOME, false)], failed.state)
    const resolved = run([{ type: "location.resolved", attempt: 2, directory: "/srv/app" }], retried.state)

    expect(retried.effects).toEqual([
      { type: "queue.reset" },
      { type: "tree.reset" },
      { type: "resolve-location", attempt: 2, timeoutMs: 30_000 },
    ])
    expect(resolved.state).toMatchObject({ status: "loading", root: HOME, locationDirectory: "/srv/app" })
    expect(pickerTreeView(resolved.state, policy).locationDirectory).toBe("/srv/app")
  }

  const located = run([{ type: "location.resolved", attempt: 1, directory: "/srv/app" }], requested.state)

  expect(located.state).toEqual({ status: "booting", issued: 1, locationDirectory: "/srv/app" })
  expect(pickerTreeView(located.state, policy).loading).toBeFalse()
})

test("expanding a folder that is still preloading moves it ahead of the queue", () => {
  const state = ready(HOME, [folder("work"), folder("repo")])
  const expanded = run([{ type: "dir.expanded", dir: "repo/" }], state)

  expect(expanded.effects).toEqual([{ type: "promote", attempt: 3 }])
  expect(run([{ type: "dir.expanded", dir: "repo/" }], expanded.state).state).toBe(expanded.state)
})

test("a listing that contains .git badges its folder once", () => {
  const state = ready(HOME, [folder("repo")])
  const listed = run([{ type: "dir.loaded", dir: "repo", attempt: 2, nodes: [folder(".git"), folder("src")] }], state)

  expect(listed.effects).toEqual([{ type: "tree.add", paths: ["repo/src/"] }, { type: "tree.refresh-decorations" }])
  expect(hasPickerGitRepo(listed.state, "repo/")).toBeTrue()
  expect(hasPickerGitRepo(listed.state, "other/")).toBeFalse()
})

test("a file picker ignores roots outside its base", () => {
  const files = pickerMode("file", "/repo")
  const state = run([navigate("/repo")], createPickerTreeState(), files).state

  expect(run([navigate("/tmp")], state, files).state).toBe(state)
})

test("disposing drops queued work and ignores later results", () => {
  const disposed = run([navigate(HOME), { type: "disposed" }])

  expect(disposed.effects).toEqual([{ type: "queue.reset" }])
  expect(run([{ type: "dir.loaded", dir: "", attempt: 1, nodes: [] }], disposed.state).state).toBe(disposed.state)
})

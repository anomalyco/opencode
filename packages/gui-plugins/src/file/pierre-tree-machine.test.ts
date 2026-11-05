import { describe, expect, test } from "bun:test"
import type { ChangeKind } from "@opencode/plugin/gui/review"
import type { FileNode } from "@opencode/plugin/gui"
import {
  createPierreTreeState,
  runPierreTreeSync,
  shouldScrollPierreTree,
  transitionPierreTree,
  type PierreTreeEffect,
  type PierreTreeEvent,
  type PierreTreeInput,
  type PierreTreeState,
} from "./pierre-tree-machine"
import { buildAllowedTreeInput, buildLiveTreeInput, type AllowedTreeInput } from "./tree-model"

/** A workspace listing as `file.tree.list` returns it: children by directory, directories with a trailing slash. */
type Listing = Record<string, readonly string[]>

function liveInput(listing: Listing, expanded: readonly string[] = [], options?: { root?: string; ignored?: string[] }) {
  const node = (path: string): FileNode => {
    const dir = path.endsWith("/")
    const clean = dir ? path.slice(0, -1) : path

    return {
      name: clean.split("/").at(-1) ?? clean,
      path: clean,
      absolute: `/repo/${clean}`,
      type: dir ? "directory" : "file",
      ignored: options?.ignored?.includes(path) ?? false,
    }
  }

  const model = buildLiveTreeInput(
    (path) => (listing[path] ?? []).map(node),
    (path) => expanded.includes(path),
  )

  return { mode: "live", root: options?.root ?? "/repo", model } satisfies PierreTreeInput
}

function allowedInput(
  model: AllowedTreeInput,
  collapsed: readonly string[] = [],
  labels?: ReadonlyMap<string, string>,
): PierreTreeInput {
  return { mode: "allowed", model, collapsedDirs: new Set(collapsed), labels }
}

function synced(input: PierreTreeInput, active = "", kinds?: ReadonlyMap<string, ChangeKind>): PierreTreeEvent {
  return { type: "synced", input, kinds, active }
}

/** Drives the machine the way the driver does, recording every effect. */
function drive(state: PierreTreeState = createPierreTreeState()) {
  const run = { state, effects: [] as PierreTreeEffect[] }

  const dispatch = (event: PierreTreeEvent) => {
    const next = transitionPierreTree(run.state, event)
    run.state = next.state
    run.effects.push(...next.effects)

    return next
  }

  const take = () => run.effects.splice(0)

  return { run, dispatch, take }
}

function mounted(state: PierreTreeState) {
  if (state.status !== "live" && state.status !== "allowed") throw new Error(`Expected a mounted tree, got ${state.status}`)

  return state
}

const project: Listing = {
  "": ["src/", "README.md"],
  src: ["src/a.ts", "src/nested/"],
  "src/nested": ["src/nested/b.ts"],
}

describe("mode", () => {
  test("allowed paths arriving after a live mount build an allowed tree instead of resetting the live one", () => {
    const tree = drive()
    tree.dispatch(synced(liveInput(project, ["src"]), "src/a.ts"))
    expect(tree.take().map((effect) => effect.type)).toEqual(["mount-tree", "schedule-scroll"])
    expect(shouldScrollPierreTree(tree.run.state, 1)).toBe(true)

    const model = buildAllowedTreeInput(["src/b.ts", "src/a.ts"])
    tree.dispatch(synced(allowedInput(model), "src/a.ts"))

    expect(tree.run.state.status).toBe("allowed")
    expect(tree.take()).toEqual([
      {
        type: "mount-tree",
        mode: "allowed",
        paths: ["src/b.ts", "src/a.ts"],
        expanded: undefined,
        selected: "src/a.ts",
        gitStatus: [],
        collapse: [],
      },
      { type: "schedule-scroll", path: "src/a.ts", attempt: 2 },
    ])
    expect(shouldScrollPierreTree(tree.run.state, 1)).toBe(false)
  })

  test("a live listing after an allowed mount builds a live tree that knows only the listed paths", () => {
    const tree = drive()
    tree.dispatch(synced(allowedInput(buildAllowedTreeInput(["other/x.ts"]))))
    tree.take()

    const input = liveInput(project, ["src"])
    tree.dispatch(synced(input))

    const state = mounted(tree.run.state)
    expect(state.status).toBe("live")
    expect(state.status === "live" && [...state.knownPaths]).toEqual(["src/", "README.md", "src/a.ts", "src/nested/"])
    expect(tree.take()).toEqual([
      {
        type: "mount-tree",
        mode: "live",
        paths: ["src/", "README.md", "src/a.ts", "src/nested/"],
        expanded: ["src/"],
        selected: "",
        gitStatus: [],
        collapse: [],
      },
    ])
  })
})

describe("programmatic sync", () => {
  test("a throw inside a sync still ends it, so the next user toggle persists", () => {
    const tree = drive()
    tree.dispatch(synced(liveInput(project, ["src"])))
    tree.take()

    expect(() =>
      runPierreTreeSync(tree.dispatch, "expansion", () => {
        tree.dispatch({ type: "tree.expansion-changed", path: "src/", expanded: false })
        throw new Error("handle threw")
      }),
    ).toThrow("handle threw")

    expect(tree.take()).toEqual([])
    expect(mounted(tree.run.state).sync).toBe("none")

    tree.dispatch({ type: "tree.expansion-changed", path: "src/", expanded: false })
    expect(tree.take()).toEqual([{ type: "persist-expansion", path: "src", expanded: false, list: true }])
  })

  test("nested syncs of both kinds unwind in order and ignore the tree's echoes meanwhile", () => {
    const tree = drive()
    tree.dispatch(synced(allowedInput(buildAllowedTreeInput(["a.ts", "b.ts"])), "a.ts"))
    tree.take()
    const seen: string[] = []

    runPierreTreeSync(tree.dispatch, "expansion", () => {
      runPierreTreeSync(tree.dispatch, "selection", () => {
        seen.push(mounted(tree.run.state).sync)
        tree.dispatch({ type: "tree.selection-changed", selected: ["b.ts"] })
      })
      seen.push(mounted(tree.run.state).sync)
    })

    expect(seen).toEqual(["both", "expansion"])
    expect(mounted(tree.run.state).sync).toBe("none")
    expect(tree.take()).toEqual([])
  })

  test("a row the tree selects by itself goes back to the active file", () => {
    const tree = drive()
    tree.dispatch(synced(allowedInput(buildAllowedTreeInput(["a.ts", "b.ts"])), "a.ts"))
    tree.take()
    const before = tree.run.state

    tree.dispatch({ type: "tree.selection-changed", selected: ["a.ts"] })
    expect(tree.run.state).toBe(before)
    expect(tree.take()).toEqual([])

    tree.dispatch({ type: "tree.selection-changed", selected: ["b.ts"] })
    expect(tree.take()).toEqual([{ type: "select", path: "a.ts" }])
  })
})

describe("live paths", () => {
  test("removing a folder forgets everything under it, so recreated files show again", () => {
    const tree = drive()
    tree.dispatch(synced(liveInput(project, ["src", "src/nested"])))
    tree.take()

    // The workspace tree prunes the deleted folder and its expansion state.
    tree.dispatch(synced(liveInput({ "": ["README.md"] })))
    expect(tree.take()).toEqual([
      { type: "batch-paths", ops: [{ type: "remove", path: "src/", recursive: true }] },
      { type: "select", path: "" },
    ])
    const removed = mounted(tree.run.state)
    expect(removed.status === "live" && [...removed.knownPaths]).toEqual(["README.md"])
    expect(removed.status === "live" && [...removed.treeExpanded]).toEqual([])

    tree.dispatch(synced(liveInput({ "": ["src/", "README.md"], src: ["src/a.ts"] })))
    expect(tree.take()).toEqual([
      { type: "batch-paths", ops: [{ type: "add", path: "src/" }] },
      { type: "select", path: "" },
    ])

    // The user opens the recreated folder; its listing arrives next.
    tree.dispatch({ type: "tree.expansion-changed", path: "src/", expanded: true })
    expect(tree.take()).toEqual([{ type: "persist-expansion", path: "src", expanded: true, list: true }])
    tree.dispatch(synced(liveInput({ "": ["src/", "README.md"], src: ["src/a.ts"] }, ["src"])))
    expect(tree.take()).toEqual([
      { type: "batch-paths", ops: [{ type: "add", path: "src/a.ts" }] },
      { type: "select", path: "" },
    ])
  })

  test("a folder another view collapses closes here, and its open subfolder keeps its state", () => {
    const listing: Listing = { "": ["src/"], src: ["src/sub/", "src/a.ts"], "src/sub": ["src/sub/b.ts"] }
    const tree = drive()
    tree.dispatch(synced(liveInput(listing, ["src", "src/sub"])))
    tree.take()

    tree.dispatch(synced(liveInput(listing, ["src/sub"])))
    expect(tree.take()).toEqual([
      { type: "sync-expansion", expand: [], collapse: ["src/"] },
      { type: "select", path: "" },
    ])

    tree.dispatch(synced(liveInput(listing, ["src", "src/sub"])))
    expect(tree.take()).toEqual([
      { type: "sync-expansion", expand: ["src/"], collapse: [] },
      { type: "select", path: "" },
    ])
  })

  test("a listing that changes nothing in the tree touches no folder handles", () => {
    const tree = drive()
    tree.dispatch(synced(liveInput(project, ["src"])))
    tree.take()
    const before = mounted(tree.run.state)

    tree.dispatch(synced(liveInput(project, ["src"])))
    const after = mounted(tree.run.state)

    expect(tree.take()).toEqual([])
    expect(after.status === "live" && before.status === "live" && after.knownPaths === before.knownPaths).toBe(true)
    expect(after.status === "live" && before.status === "live" && after.treeExpanded === before.treeExpanded).toBe(
      true,
    )
  })
})

describe("allowed expansion", () => {
  test("a folder another view collapses closes without resetting the rows", () => {
    const model = buildAllowedTreeInput(["src/a.ts", "b.ts"])
    const tree = drive()
    tree.dispatch(synced(allowedInput(model)))
    tree.take()

    tree.dispatch(synced(allowedInput(model, ["src"])))
    expect(tree.take()).toEqual([{ type: "sync-expansion", expand: [], collapse: ["src"] }])

    tree.dispatch(synced(allowedInput(model)))
    expect(tree.take()).toEqual([{ type: "sync-expansion", expand: ["src"], collapse: [] }])
  })

  test("new allowed paths reset the rows and collapse the closed folders again", () => {
    const tree = drive()
    tree.dispatch(synced(allowedInput(buildAllowedTreeInput(["src/a.ts"])), "src/a.ts"))
    tree.take()

    tree.dispatch(synced(allowedInput(buildAllowedTreeInput(["src/a.ts", "docs/b.md"]), ["docs"]), "src/a.ts"))
    expect(tree.take()).toEqual([
      { type: "select", path: "" },
      { type: "reset-paths", paths: ["src/a.ts", "docs/b.md"], expanded: undefined },
      { type: "sync-expansion", expand: [], collapse: ["docs"] },
      { type: "select", path: "src/a.ts" },
    ])
  })

  test("changed folder labels re-render the rows", () => {
    const model = buildAllowedTreeInput(["research/"])
    const tree = drive()
    tree.dispatch(synced(allowedInput(model, ["research"], new Map([["research", "2 files"]]))))
    tree.take()

    tree.dispatch(synced(allowedInput(model, ["research"], new Map([["research", "2 files"]]))))
    expect(tree.take()).toEqual([])

    tree.dispatch(synced(allowedInput(model, ["research"], new Map([["research", "3 files"]]))))
    expect(tree.take()).toEqual([{ type: "rerender" }])
  })
})

describe("scroll", () => {
  test("a scroll microtask for an earlier active file does nothing", () => {
    const model = buildAllowedTreeInput(["a.ts", "b.ts"])
    const tree = drive()
    tree.dispatch(synced(allowedInput(model)))
    tree.dispatch(synced(allowedInput(model), "a.ts"))
    tree.dispatch(synced(allowedInput(model), "b.ts"))
    expect(tree.take().filter((effect) => effect.type === "schedule-scroll")).toEqual([
      { type: "schedule-scroll", path: "a.ts", attempt: 1 },
      { type: "schedule-scroll", path: "b.ts", attempt: 2 },
    ])

    expect(shouldScrollPierreTree(tree.run.state, 1)).toBe(false)
    const before = tree.run.state
    tree.dispatch({ type: "scroll.flushed", attempt: 1 })
    expect(tree.run.state).toBe(before)

    expect(shouldScrollPierreTree(tree.run.state, 2)).toBe(true)
    tree.dispatch({ type: "scroll.flushed", attempt: 2 })
    expect(mounted(tree.run.state).scroll).toEqual({ status: "idle", scrolledPath: "b.ts", issued: 2 })
  })

  test("an active file under a collapsed allowed folder scrolls once the user opens the folder", () => {
    const model = buildAllowedTreeInput(["src/a.ts", "b.ts"])
    const tree = drive()
    tree.dispatch(synced(allowedInput(model, ["src"])))
    tree.take()
    tree.dispatch(synced(allowedInput(model, ["src"]), "src/a.ts"))
    expect(tree.take()).toEqual([{ type: "select", path: "src/a.ts" }])

    tree.dispatch({ type: "tree.expansion-changed", path: "src", expanded: true })
    expect(tree.take()).toEqual([
      { type: "schedule-scroll", path: "src/a.ts", attempt: 1 },
      { type: "persist-expansion", path: "src", expanded: true, list: false },
    ])
  })

  test("an active file under a collapsed live folder scrolls once the folder opens", () => {
    const listing: Listing = { "": ["src/", "b.ts"], src: ["src/a.ts"] }
    const tree = drive()
    tree.dispatch(synced(liveInput(listing, ["src"])))
    tree.dispatch(synced(liveInput(listing)))
    tree.take()

    // The tree still holds the file, so it stays selected, but it is not on screen.
    tree.dispatch(synced(liveInput(listing), "src/a.ts"))
    expect(tree.take()).toEqual([{ type: "select", path: "src/a.ts" }])

    tree.dispatch(synced(liveInput(listing, ["src"]), "src/a.ts"))
    expect(tree.take()).toEqual([
      { type: "sync-expansion", expand: ["src/"], collapse: [] },
      { type: "select", path: "src/a.ts" },
      { type: "schedule-scroll", path: "src/a.ts", attempt: 1 },
    ])
  })

  test("returning to a file through an unloaded one scrolls to it again", () => {
    const model = buildAllowedTreeInput(["a.ts"])
    const tree = drive()
    tree.dispatch(synced(allowedInput(model), "a.ts"))
    tree.dispatch({ type: "scroll.flushed", attempt: 1 })
    tree.dispatch(synced(allowedInput(model), "missing/b.ts"))
    tree.take()

    tree.dispatch(synced(allowedInput(model), "a.ts"))
    expect(tree.take()).toEqual([
      { type: "select", path: "a.ts" },
      { type: "schedule-scroll", path: "a.ts", attempt: 2 },
    ])
  })

  test("another workspace root scrolls to the same active path again", () => {
    const listing: Listing = { "": ["src/"], src: ["src/index.ts"] }
    const tree = drive()
    tree.dispatch(synced(liveInput(listing, ["src"], { root: "/one" }), "src/index.ts"))
    tree.dispatch({ type: "scroll.flushed", attempt: 1 })
    tree.take()

    const next = liveInput(listing, ["src"], { root: "/two" })
    tree.dispatch(synced(next, "src/index.ts"))
    expect(tree.take()).toEqual([
      { type: "reset-paths", paths: ["src/", "src/index.ts"], expanded: ["src/"] },
      { type: "select", path: "src/index.ts" },
      { type: "schedule-scroll", path: "src/index.ts", attempt: 2 },
    ])
  })
})

describe("no-op updates", () => {
  test("unchanged inputs and measurements keep the same state and do nothing", () => {
    const input = liveInput(project, ["src"])
    const kinds = new Map<string, ChangeKind>([["src/a.ts", "add"]])
    const tree = drive()
    tree.dispatch(synced(input, "src/a.ts", kinds))
    tree.dispatch({ type: "list.measured", width: 400 })
    tree.take()
    const before = tree.run.state

    for (const event of [
      synced(input, "src/a.ts", kinds),
      { type: "list.measured", width: 300 },
      { type: "tree.selection-changed", selected: ["src/a.ts"] },
      { type: "sync.ended", kind: "expansion" },
    ] satisfies PierreTreeEvent[]) {
      expect(transitionPierreTree(before, event)).toEqual({ state: before, effects: [] })
      expect(transitionPierreTree(before, event).state).toBe(before)
    }
  })

  test("an equal change-kinds map patches nothing, and an ignored-only change patches only that entry", () => {
    const kinds = new Map<string, ChangeKind>([["src/a.ts", "add"]])
    const listing: Listing = { "": ["src/", "dist/"], src: ["src/a.ts"] }
    const tree = drive()
    tree.dispatch(synced(liveInput(listing, ["src"]), "", kinds))
    tree.take()
    const before = mounted(tree.run.state)

    tree.dispatch(synced(liveInput(listing, ["src"]), "", new Map(kinds)))
    expect(tree.take()).toEqual([])

    tree.dispatch(synced(liveInput(listing, ["src"], { ignored: ["dist/"] }), "", kinds))
    expect(tree.take()).toEqual([{ type: "patch-git-status", patch: { remove: [], set: [{ path: "dist/", status: "ignored" }] } }])
    expect(mounted(tree.run.state).kindsStatus).toBe(before.kindsStatus)
  })

  test("a wider list widens the tree once, and a structural change measures from the pane again", () => {
    const tree = drive()
    tree.dispatch(synced(liveInput(project)))
    tree.dispatch({ type: "list.measured", width: 400 })
    expect(tree.take().slice(1)).toEqual([{ type: "set-min-width", width: 400 }])

    tree.dispatch({ type: "tree.expansion-changed", path: "src/", expanded: true })
    expect(tree.take()).toEqual([
      { type: "reset-width" },
      { type: "persist-expansion", path: "src", expanded: true, list: true },
    ])
    expect(mounted(tree.run.state).widest).toBe(0)
  })
})

describe("disposal", () => {
  test("disposing tears the tree down, cancels a pending scroll, and ignores everything after", () => {
    const tree = drive()
    tree.dispatch(synced(allowedInput(buildAllowedTreeInput(["a.ts"])), "a.ts"))
    tree.take()

    tree.dispatch({ type: "disposed" })
    expect(tree.take()).toEqual([{ type: "cleanup" }])
    expect(shouldScrollPierreTree(tree.run.state, 1)).toBe(false)

    const disposed = tree.run.state
    for (const event of [
      synced(allowedInput(buildAllowedTreeInput(["b.ts"])), "b.ts"),
      { type: "scroll.flushed", attempt: 1 },
      { type: "disposed" },
    ] satisfies PierreTreeEvent[]) {
      expect(transitionPierreTree(disposed, event).state).toBe(disposed)
      expect(transitionPierreTree(disposed, event).effects).toEqual([])
    }
  })

  test("disposing before the tree mounts has nothing to tear down", () => {
    expect(transitionPierreTree(createPierreTreeState(), { type: "disposed" })).toEqual({
      state: { status: "disposed" },
      effects: [],
    })
  })
})

import { describe, expect, test } from "bun:test"
import type { ConfigEntry } from "@opencode/client"
import { AbsolutePath } from "@opencode/schema/schema"
import type { TreeRefreshTarget } from "./tree-model"
import {
  DEFAULT_TREE_REFRESH_CONCURRENCY,
  INITIAL_TREE_REFRESH_STATE,
  isTreeRefreshPending,
  transitionTreeRefresh,
  treeRefreshConcurrency,
  type TreeRefreshEffect,
  type TreeRefreshEvent,
  type TreeRefreshScope,
  type TreeRefreshState,
} from "./tree-refresh-machine"

const scope: TreeRefreshScope = { serverID: "local", root: "C:/alpha" }

const dirs = (...names: string[]): TreeRefreshTarget[] => names.map((dir) => ({ dir, original: dir }))

const started = (targets: TreeRefreshTarget[]): TreeRefreshEvent => ({ type: "started", scope, targets })

const settled = (attempt: number, dir: string, error?: string): TreeRefreshEvent => ({
  type: "sync.settled",
  attempt,
  dir,
  error,
})

const skipped = (attempt: number, dir: string): TreeRefreshEvent => ({ type: "sync.skipped", attempt, dir })

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: TreeRefreshState, ...events: TreeRefreshEvent[]) {
  return events.reduce<{ state: TreeRefreshState; effects: readonly TreeRefreshEffect[] }>(
    (result, event) => {
      const next = transitionTreeRefresh(result.state, event)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    },
    { state, effects: [] },
  )
}

/** The sync effects of one transition, without the report. */
const syncs = (transition: { effects: readonly TreeRefreshEffect[] }) =>
  transition.effects.filter((effect): effect is Extract<TreeRefreshEffect, { type: "sync" }> => effect.type === "sync")

describe("transitionTreeRefresh", () => {
  test("a click captures targets, then the config starts as many syncs as the action's slots hold", () => {
    const click = transitionTreeRefresh(INITIAL_TREE_REFRESH_STATE, started(dirs("", "src", "src/lib", "docs")))

    expect(click.effects).toEqual([])
    expect(click.state).toMatchObject({ status: "starting", attempt: 1, scope })
    expect(isTreeRefreshPending(click.state)).toBe(true)

    const begin = transitionTreeRefresh(click.state, { type: "config.settled", attempt: 1, concurrency: 2 })

    expect(syncs(begin)).toEqual([
      { type: "sync", attempt: 1, target: { dir: "", original: "" } },
      { type: "sync", attempt: 1, target: { dir: "src", original: "src" } },
    ])
    expect(begin.state).toMatchObject({
      status: "running",
      concurrency: 2,
      pending: [{ dir: "src/lib", original: "src/lib" }, { dir: "docs", original: "docs" }],
      active: new Set(["", "src"]),
    })
  })

  test("each settled sync schedules at most one next, and the action ends idle", () => {
    const begin = play(INITIAL_TREE_REFRESH_STATE, started(dirs("", "src", "src/lib")), {
      type: "config.settled",
      attempt: 1,
      concurrency: 2,
    })

    const last = play(begin.state, settled(1, ""), settled(1, "src"), settled(1, "src/lib"))

    expect(syncs(last)).toEqual([{ type: "sync", attempt: 1, target: { dir: "src/lib", original: "src/lib" } }])
    expect(last.state).toEqual({ status: "idle", attempt: 1 })
    expect(isTreeRefreshPending(last.state)).toBe(false)
  })

  test("a settled sync schedules the next only while slots free up, one per settle", () => {
    const begin = play(INITIAL_TREE_REFRESH_STATE, started(dirs("", "a", "b", "c")), {
      type: "config.settled",
      attempt: 1,
      concurrency: 2,
    })

    const one = transitionTreeRefresh(begin.state, settled(1, ""))

    expect(syncs(one)).toEqual([{ type: "sync", attempt: 1, target: { dir: "b", original: "b" } }])
    expect(one.state).toMatchObject({ pending: [{ dir: "c", original: "c" }], active: new Set(["a", "b"]) })

    const two = transitionTreeRefresh(one.state, settled(1, "a"))

    expect(syncs(two)).toEqual([{ type: "sync", attempt: 1, target: { dir: "c", original: "c" } }])
    expect(two.state).toMatchObject({ pending: [], active: new Set(["b", "c"]) })
  })

  test("a click while the action runs is a duplicate no-op", () => {
    const begin = play(INITIAL_TREE_REFRESH_STATE, started(dirs("", "src")), {
      type: "config.settled",
      attempt: 1,
      concurrency: 4,
    })

    const duplicate = transitionTreeRefresh(begin.state, started(dirs("", "other")))

    expect(duplicate.state).toBe(begin.state)
    expect(duplicate.effects).toEqual([])
  })

  test("a click while the config is read is a duplicate no-op", () => {
    const click = transitionTreeRefresh(INITIAL_TREE_REFRESH_STATE, started(dirs("")))

    const duplicate = transitionTreeRefresh(click.state, started(dirs("", "src")))
    const begin = transitionTreeRefresh(duplicate.state, { type: "config.settled", attempt: 1, concurrency: 4 })

    expect(syncs(begin)).toEqual([{ type: "sync", attempt: 1, target: { dir: "", original: "" } }])
  })

  test("a rejected config read reports once and re-enables the button", () => {
    const begin = transitionTreeRefresh(INITIAL_TREE_REFRESH_STATE, started(dirs("", "src")))

    const failed = transitionTreeRefresh(begin.state, {
      type: "config.failed",
      attempt: 1,
      error: "config unavailable",
    })

    expect(failed.state).toEqual({ status: "idle", attempt: 1 })
    expect(failed.effects).toEqual([{ type: "report", attempt: 1, errors: ["config unavailable"] }])
  })

  test("rejected syncs are collected and reported once when the action settles", () => {
    const begin = play(INITIAL_TREE_REFRESH_STATE, started(dirs("", "src", "src/lib")), {
      type: "config.settled",
      attempt: 1,
      concurrency: 4,
    })

    const done = play(begin.state, settled(1, "", "root unreachable"), settled(1, "src"), settled(1, "src/lib"))

    expect(done.effects).toEqual([{ type: "report", attempt: 1, errors: ["root unreachable"] }])
    expect(done.state).toEqual({ status: "idle", attempt: 1 })
  })

  test("a clean action reports nothing", () => {
    const begin = play(INITIAL_TREE_REFRESH_STATE, started(dirs("")), { type: "config.settled", attempt: 1, concurrency: 4 })

    const done = transitionTreeRefresh(begin.state, settled(1, ""))

    expect(done.effects).toEqual([])
    expect(done.state).toEqual({ status: "idle", attempt: 1 })
  })

  test("a settled sync the action never started is stale", () => {
    const begin = play(INITIAL_TREE_REFRESH_STATE, started(dirs("")), { type: "config.settled", attempt: 1, concurrency: 4 })

    const stale = transitionTreeRefresh(begin.state, settled(1, "src"))

    expect(stale.state).toBe(begin.state)
    expect(stale.effects).toEqual([])
  })

  test("a settle of a previous attempt never schedules or reports", () => {
    const begin = play(INITIAL_TREE_REFRESH_STATE, started(dirs("", "src")), {
      type: "config.settled",
      attempt: 1,
      concurrency: 4,
    })

    // The action dropped its scope, a new one started, then the old sync settled.
    const next = play(begin.state, { type: "scope.changed" }, started(dirs("", "src")), {
      type: "config.settled",
      attempt: 2,
      concurrency: 4,
    })

    const stale = transitionTreeRefresh(next.state, settled(1, "src"))

    expect(stale.state).toBe(next.state)
    expect(stale.effects).toEqual([])

    // The old action's config settlement, however late, cannot touch the new action either.
    const staleConfig = transitionTreeRefresh(next.state, { type: "config.settled", attempt: 1, concurrency: 99 })

    expect(staleConfig.state).toBe(next.state)
    expect(staleConfig.effects).toEqual([])
  })

  test("a skipped pruned target schedules the next and settles without an error", () => {
    const begin = play(INITIAL_TREE_REFRESH_STATE, started(dirs("", "src", "src/lib")), {
      type: "config.settled",
      attempt: 1,
      concurrency: 1,
    })

    const skippedPruned = transitionTreeRefresh(begin.state, skipped(1, ""))

    expect(syncs(skippedPruned)).toEqual([{ type: "sync", attempt: 1, target: { dir: "src", original: "src" } }])

    const done = transitionTreeRefresh(skippedPruned.state, skipped(1, "src"))

    expect(syncs(done)).toEqual([{ type: "sync", attempt: 1, target: { dir: "src/lib", original: "src/lib" } }])
  })

  test("a scope change drops pending targets and collected errors without notifying", () => {
    const begin = play(INITIAL_TREE_REFRESH_STATE, started(dirs("", "src", "src/lib")), {
      type: "config.settled",
      attempt: 1,
      concurrency: 1,
    })

    const failed = play(begin.state, settled(1, "", "root unreachable"))

    expect(failed.state.status).toBe("running")

    const changed = transitionTreeRefresh(failed.state, { type: "scope.changed" })

    expect(changed.state).toEqual({ status: "idle", attempt: 1 })
    expect(changed.effects).toEqual([])
    expect(isTreeRefreshPending(changed.state)).toBe(false)

    // The dropped sync's settle is stale: the button re-enabled by the scope change takes a new attempt.
    const stale = transitionTreeRefresh(changed.state, settled(1, "src", "gone"))

    expect(stale.state).toBe(changed.state)
    expect(stale.effects).toEqual([])
  })

  test("a disposed machine answers nothing", () => {
    const begin = play(INITIAL_TREE_REFRESH_STATE, started(dirs("", "src")), {
      type: "config.settled",
      attempt: 1,
      concurrency: 4,
    })

    const disposed = transitionTreeRefresh(begin.state, { type: "disposed" })

    expect(disposed.state).toMatchObject({ status: "disposed", attempt: 1 })

    const after = play(disposed.state, settled(1, "", "late failure"), { type: "scope.changed" }, started(dirs("")))

    expect(after.state).toBe(disposed.state)
    expect(after.effects).toEqual([])
  })
})

describe("treeRefreshConcurrency", () => {
  const document = (info?: Extract<ConfigEntry, { type: "document" }>["info"]): ConfigEntry => ({
    type: "document",
    info: info ?? {},
  })

  const directory = (path: string): ConfigEntry => ({ type: "directory", path: AbsolutePath.make(path) })

  test("the last config document naming the value wins, and the default is 4", () => {
    expect(treeRefreshConcurrency([])).toBe(DEFAULT_TREE_REFRESH_CONCURRENCY)
    expect(
      treeRefreshConcurrency([
        directory("/home/user/.config/opencode"),
        document({ file_tree: { refresh_concurrency: 8 } }),
        directory("/project/.opencode"),
        document({ file_tree: { refresh_concurrency: 2 } }),
      ]),
    ).toBe(2)
  })

  test("a directory root names no value, and an empty document keeps the previous one", () => {
    expect(treeRefreshConcurrency([directory("/project/.opencode")])).toBe(DEFAULT_TREE_REFRESH_CONCURRENCY)
    expect(treeRefreshConcurrency([document({ file_tree: { refresh_concurrency: 6 } }), document()])).toBe(6)
    expect(treeRefreshConcurrency([document(), document({ file_tree: { refresh_concurrency: 3 } })])).toBe(3)
  })
})

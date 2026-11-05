import { describe, expect, test } from "bun:test"
import {
  createWorkspaceDeleteState,
  isWorkspaceDeleteBusy,
  transitionWorkspaceDelete,
  visibleWorkspaces,
  WORKSPACE_COLLAPSE_MS,
  WORKSPACE_DELETE_TIMEOUT_MS,
  WORKSPACE_INSPECT_TIMEOUT_MS,
  workspaceConfirmView,
  workspaceRowView,
  type WorkspaceDeleteEffect,
  type WorkspaceDeleteEvent,
  type WorkspaceDeleteState,
  type WorkspaceTarget,
} from "./delete-machine"

const target = (name: string): WorkspaceTarget => ({
  key: `/repo/${name}`,
  directory: `/repo/${name}`,
  projectID: "proj",
  projectWorktree: "/repo",
})

const a = target("a")

const b = target("b")

const c = target("c")

function replay(events: WorkspaceDeleteEvent[], state = createWorkspaceDeleteState()) {
  return events.reduce<{ state: WorkspaceDeleteState; effects: readonly WorkspaceDeleteEffect[] }>(
    (step, event) => transitionWorkspaceDelete(step.state, event),
    { state, effects: [] },
  )
}

const run = (attempt: number, item: WorkspaceTarget, force: boolean, active?: string): WorkspaceDeleteEffect => ({
  type: "delete.run",
  attempt,
  target: item,
  force,
  active,
  timeoutMs: WORKSPACE_DELETE_TIMEOUT_MS,
})

const clean = { active: false, linked: false, dirty: false }

const dirty = { active: false, linked: false, dirty: true }

const inspect = (attempt: number, item: WorkspaceTarget, active?: string): WorkspaceDeleteEffect => ({
  type: "inspect.run",
  attempt,
  directory: item.directory,
  active,
  timeoutMs: WORKSPACE_INSPECT_TIMEOUT_MS,
})

// Opens the single-worktree confirmation (attempt 1), passes its check (attempt 2) and accepts it.
const acceptOne = (item: WorkspaceTarget): WorkspaceDeleteEvent[] => [
  { type: "confirm.opened", scope: "one", active: undefined, targets: [item] },
  { type: "inspect.succeeded", attempt: 2, inspection: clean },
  { type: "confirm.accepted", attempt: 1 },
]

describe("workspace delete machine", () => {
  test("a closing dialog's late cancel does not cancel the next confirmation", () => {
    const next = replay([
      ...acceptOne(a),
      { type: "delete.skipped", attempt: 3, reason: { kind: "failed", message: "busy" } },
      { type: "confirm.opened", scope: "one", active: undefined, targets: [b] },
      { type: "inspect.succeeded", attempt: 5, inspection: clean },
    ])

    expect(next.state).toMatchObject({ status: "confirming", attempt: 4 })

    // The first dialog's exit animation ends now and reports its close.
    const late = transitionWorkspaceDelete(next.state, { type: "confirm.cancelled", attempt: 1 })
    expect(late.state).toBe(next.state)
    expect(isWorkspaceDeleteBusy(late.state)).toBe(true)
    expect(transitionWorkspaceDelete(late.state, { type: "confirm.accepted", attempt: 4 }).effects).toEqual([
      run(6, b, true),
    ])
  })

  test("a failed check offers Retry instead of stranding the confirmation", () => {
    const opened = replay([{ type: "confirm.opened", scope: "one", active: "/repo", targets: [a] }])
    expect(opened.effects).toEqual([
      { type: "open.confirm", attempt: 1, scope: "one", active: "/repo", targets: [a] },
      inspect(2, a, "/repo"),
    ])
    expect(workspaceConfirmView(opened.state, 1)).toEqual({
      checking: true,
      failed: false,
      canDelete: false,
      inspection: undefined,
    })

    for (const type of ["inspect.failed", "inspect.timed-out"] as const) {
      const failed = transitionWorkspaceDelete(opened.state, { type, attempt: 2 })
      expect(failed.effects).toEqual([{ type: "inspect.stop", attempt: 2 }])
      expect(workspaceConfirmView(failed.state, 1)).toEqual({
        checking: false,
        failed: true,
        canDelete: false,
        inspection: undefined,
      })
      expect(transitionWorkspaceDelete(failed.state, { type: "confirm.accepted", attempt: 1 }).state).toBe(failed.state)

      const retried = transitionWorkspaceDelete(failed.state, { type: "inspect.retried", attempt: 1 })
      expect(retried.effects).toEqual([inspect(3, a, "/repo")])
      expect(workspaceConfirmView(retried.state, 1).checking).toBe(true)
      // A second click while the retry runs starts nothing.
      expect(transitionWorkspaceDelete(retried.state, { type: "inspect.retried", attempt: 1 }).state).toBe(
        retried.state,
      )

      const ready = replay(
        [
          { type: "inspect.succeeded", attempt: 3, inspection: dirty },
          { type: "confirm.accepted", attempt: 1 },
        ],
        retried.state,
      )

      expect(ready.effects).toEqual([run(4, a, true, "/repo")])
    }
  })

  test("Delete does nothing until the check passes, and the dialog keeps its warnings while it closes", () => {
    const checking = replay([{ type: "confirm.opened", scope: "one", active: undefined, targets: [a] }]).state
    expect(transitionWorkspaceDelete(checking, { type: "confirm.accepted", attempt: 1 }).state).toBe(checking)

    const deleting = replay(
      [
        { type: "inspect.succeeded", attempt: 2, inspection: dirty },
        { type: "confirm.accepted", attempt: 1 },
      ],
      checking,
    ).state

    expect(workspaceConfirmView(deleting, 1)).toEqual({
      checking: false,
      failed: false,
      canDelete: false,
      inspection: dirty,
    })
  })

  test("closing or leaving a confirmation stops its check, and a late check result is ignored", () => {
    const checking = replay([{ type: "confirm.opened", scope: "one", active: undefined, targets: [a] }]).state

    const cancelled = transitionWorkspaceDelete(checking, { type: "confirm.cancelled", attempt: 1 })
    expect(cancelled).toEqual({
      state: { status: "idle", issued: 2, removed: {} },
      effects: [{ type: "inspect.stop", attempt: 2 }],
    })
    expect(
      transitionWorkspaceDelete(cancelled.state, { type: "inspect.succeeded", attempt: 2, inspection: clean }).state,
    ).toBe(cancelled.state)

    expect(transitionWorkspaceDelete(checking, { type: "disposed" })).toEqual({
      state: { status: "disposed" },
      effects: [{ type: "inspect.stop", attempt: 2 }],
    })

    const retried = replay(
      [
        { type: "inspect.failed", attempt: 2 },
        { type: "inspect.retried", attempt: 1 },
      ],
      checking,
    ).state

    expect(transitionWorkspaceDelete(retried, { type: "inspect.succeeded", attempt: 2, inspection: clean }).state).toBe(
      retried,
    )
  })

  test("a collapsed row stays hidden until the inventory drops it", () => {
    const collapsing = replay([...acceptOne(a), { type: "delete.succeeded", attempt: 3, target: a }])

    expect(collapsing.effects).toEqual([
      { type: "delete.timer.stop", attempt: 3 },
      { type: "collapse.start", attempt: 3, delayMs: WORKSPACE_COLLAPSE_MS },
    ])
    expect(workspaceRowView(collapsing.state, a.key)).toEqual({ deleting: true, collapsing: true })
    expect(visibleWorkspaces(collapsing.state, [a, b], (item) => item.key)).toEqual([a, b])

    const collapsed = transitionWorkspaceDelete(collapsing.state, { type: "collapse.completed", attempt: 3 })
    expect(collapsed.effects).toEqual([{ type: "finalize.removed", target: a }])
    expect(collapsed.state).toMatchObject({ status: "idle" })
    // The inventory still lists it while it refetches, and the row must not come back.
    expect(visibleWorkspaces(collapsed.state, [a, b], (item) => item.key)).toEqual([b])
    const stale = transitionWorkspaceDelete(collapsed.state, { type: "inventory.synced", keys: [a.key, b.key] })
    expect(stale.state).toBe(collapsed.state)

    const synced = transitionWorkspaceDelete(collapsed.state, { type: "inventory.synced", keys: [b.key] })
    expect(synced.state).toEqual({ status: "idle", issued: 3, removed: {} })
  })

  test("a bulk delete moves past blocked, failed and timed-out worktrees", () => {
    const blocked = { active: false, linked: true, dirty: false }
    const opened = replay([{ type: "confirm.opened", scope: "all", active: "/repo", targets: [a, b, c] }])
    expect(opened.effects).toEqual([
      { type: "open.confirm", attempt: 1, scope: "all", active: "/repo", targets: [a, b, c] },
    ])

    const first = transitionWorkspaceDelete(opened.state, { type: "confirm.accepted", attempt: 1 })
    expect(first.effects).toEqual([run(2, a, false, "/repo")])

    const second = transitionWorkspaceDelete(first.state, {
      type: "delete.skipped",
      attempt: 2,
      reason: { kind: "blocked", inspection: blocked },
    })

    expect(second.effects).toEqual([
      { type: "delete.timer.stop", attempt: 2 },
      { type: "toast.skipped", reason: { kind: "blocked", inspection: blocked } },
      run(3, b, false, "/repo"),
    ])

    const third = replay(
      [
        { type: "delete.succeeded", attempt: 3, target: b },
        { type: "collapse.completed", attempt: 3 },
      ],
      second.state,
    )

    expect(third.effects).toEqual([{ type: "finalize.removed", target: b }, run(4, c, false, "/repo")])

    const done = transitionWorkspaceDelete(third.state, { type: "delete.timed-out", attempt: 4 })
    expect(done.effects).toEqual([
      { type: "delete.timer.stop", attempt: 4 },
      { type: "toast.skipped", reason: { kind: "timed-out" } },
    ])
    expect(done.state).toEqual({ status: "idle", issued: 4, removed: { [b.key]: true } })

    // The timed-out removal finished on the server after all.
    expect(transitionWorkspaceDelete(done.state, { type: "delete.succeeded", attempt: 4, target: c })).toEqual({
      state: done.state,
      effects: [{ type: "finalize.removed", target: c }],
    })
    expect(
      transitionWorkspaceDelete(done.state, { type: "delete.skipped", attempt: 4, reason: { kind: "timed-out" } })
        .state,
    ).toBe(done.state)
  })

  test("closing the list mid-delete still reconciles what the server removed", () => {
    const collapsing = replay([...acceptOne(a), { type: "delete.succeeded", attempt: 3, target: a }])

    expect(transitionWorkspaceDelete(collapsing.state, { type: "disposed" }).effects).toEqual([
      { type: "collapse.cancel" },
      { type: "finalize.removed", target: a },
    ])

    const deleting = replay([...acceptOne(a), { type: "disposed" }])

    expect(deleting.effects).toEqual([{ type: "delete.timer.stop", attempt: 3 }])
    expect(
      transitionWorkspaceDelete(deleting.state, { type: "delete.succeeded", attempt: 3, target: a }).effects,
    ).toEqual([{ type: "finalize.removed", target: a }])
    expect(
      transitionWorkspaceDelete(deleting.state, {
        type: "confirm.opened",
        scope: "all",
        active: undefined,
        targets: [b],
      }).effects,
    ).toEqual([])
  })

  test("only one confirmation opens at a time, and an empty one does not open", () => {
    const empty = createWorkspaceDeleteState()
    expect(
      transitionWorkspaceDelete(empty, { type: "confirm.opened", scope: "unused", active: undefined, targets: [] })
        .state,
    ).toBe(empty)

    const confirming = replay([{ type: "confirm.opened", scope: "one", active: undefined, targets: [a] }])
    expect(
      transitionWorkspaceDelete(confirming.state, {
        type: "confirm.opened",
        scope: "one",
        active: undefined,
        targets: [b],
      }).state,
    ).toBe(confirming.state)
    expect(transitionWorkspaceDelete(confirming.state, { type: "confirm.cancelled", attempt: 1 }).state).toEqual({
      status: "idle",
      issued: 2,
      removed: {},
    })
  })
})

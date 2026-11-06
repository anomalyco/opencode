import { describe, expect, test } from "bun:test"
import {
  createWorkspaceDeleteState,
  isWorkspaceDeleteBusy,
  transitionWorkspaceDelete,
  visibleWorkspaces,
  WORKSPACE_COLLAPSE_MS,
  WORKSPACE_DELETE_TIMEOUT_MS,
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

describe("workspace delete machine", () => {
  test("a closing dialog's late cancel does not cancel the next confirmation", () => {
    const next = replay([
      { type: "confirm.opened", scope: "one", active: undefined, targets: [a] },
      { type: "confirm.accepted", attempt: 1 },
      { type: "delete.skipped", attempt: 2, reason: { kind: "failed", message: "busy" } },
      { type: "confirm.opened", scope: "one", active: undefined, targets: [b] },
    ])

    expect(next.state).toMatchObject({ status: "confirming", attempt: 3 })

    // The first dialog's exit animation ends now and reports its close.
    const late = transitionWorkspaceDelete(next.state, { type: "confirm.cancelled", attempt: 1 })
    expect(late.state).toBe(next.state)
    expect(isWorkspaceDeleteBusy(late.state)).toBe(true)
    expect(transitionWorkspaceDelete(late.state, { type: "confirm.accepted", attempt: 3 }).effects).toEqual([
      run(4, b, true),
    ])
  })

  test("a collapsed row stays hidden until the inventory drops it", () => {
    const collapsing = replay([
      { type: "confirm.opened", scope: "one", active: undefined, targets: [a] },
      { type: "confirm.accepted", attempt: 1 },
      { type: "delete.succeeded", attempt: 2, target: a },
    ])

    expect(collapsing.effects).toEqual([
      { type: "delete.timer.stop", attempt: 2 },
      { type: "collapse.start", attempt: 2, delayMs: WORKSPACE_COLLAPSE_MS },
    ])
    expect(workspaceRowView(collapsing.state, a.key)).toEqual({ deleting: true, collapsing: true })
    expect(visibleWorkspaces(collapsing.state, [a, b], (item) => item.key)).toEqual([a, b])

    const collapsed = transitionWorkspaceDelete(collapsing.state, { type: "collapse.completed", attempt: 2 })
    expect(collapsed.effects).toEqual([{ type: "finalize.removed", target: a }])
    expect(collapsed.state).toMatchObject({ status: "idle" })
    // The inventory still lists it while it refetches, and the row must not come back.
    expect(visibleWorkspaces(collapsed.state, [a, b], (item) => item.key)).toEqual([b])
    const stale = transitionWorkspaceDelete(collapsed.state, { type: "inventory.synced", keys: [a.key, b.key] })
    expect(stale.state).toBe(collapsed.state)

    const synced = transitionWorkspaceDelete(collapsed.state, { type: "inventory.synced", keys: [b.key] })
    expect(synced.state).toEqual({ status: "idle", issued: 2, removed: {} })
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
    const collapsing = replay([
      { type: "confirm.opened", scope: "one", active: undefined, targets: [a] },
      { type: "confirm.accepted", attempt: 1 },
      { type: "delete.succeeded", attempt: 2, target: a },
    ])

    expect(transitionWorkspaceDelete(collapsing.state, { type: "disposed" }).effects).toEqual([
      { type: "collapse.cancel" },
      { type: "finalize.removed", target: a },
    ])

    const deleting = replay([
      { type: "confirm.opened", scope: "one", active: undefined, targets: [a] },
      { type: "confirm.accepted", attempt: 1 },
      { type: "disposed" },
    ])

    expect(deleting.effects).toEqual([{ type: "delete.timer.stop", attempt: 2 }])
    expect(
      transitionWorkspaceDelete(deleting.state, { type: "delete.succeeded", attempt: 2, target: a }).effects,
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
      issued: 1,
      removed: {},
    })
  })
})

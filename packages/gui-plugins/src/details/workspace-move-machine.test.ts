import { describe, expect, test } from "bun:test"
import {
  WORKSPACE_CREATE_TIMEOUT_MS,
  WORKSPACE_LIST_TIMEOUT_MS,
  WORKSPACE_MOVE_TIMEOUT_MS,
  WORKSPACE_REMOVE_TIMEOUT_MS,
  createWorkspaceMoveState,
  transitionWorkspaceMove,
  workspaceDialogView,
  workspaceMenuView,
  type WorkspaceMoveEvent,
  type WorkspaceMoveState,
  type WorkspaceMoveTransition,
} from "./workspace-move-machine"

const root = "C:/OpenCode/repo"

const created = "C:/OpenCode/worktrees/quiet-river"

const project = { id: "proj_repo", worktree: root, sandboxes: [`${root}-feature`] }

// The state once a menu shows the session's destinations, as every controller starts.
const mounted = transitionWorkspaceMove(createWorkspaceMoveState(project.id), { type: "mounted" }).state

// Folds the events in order and returns the last transition.
const replay = (events: readonly WorkspaceMoveEvent[], state: WorkspaceMoveState = mounted) =>
  events.reduce<WorkspaceMoveTransition>((last, event) => transitionWorkspaceMove(last.state, event), {
    state,
    effects: [],
  })

const createRequested: WorkspaceMoveEvent = {
  type: "move.requested",
  target: { type: "create", sourceDirectory: root },
  running: false,
}

const worktreeCreated = (attempt: number, running = false): WorkspaceMoveEvent => ({
  type: "worktree.created",
  attempt,
  projectID: project.id,
  directory: created,
  running,
})

// New worktree, then a move that fails: attempt 1 creates, 2 moves, 3 is the recovery dialog.
const failedMove = [
  createRequested,
  worktreeCreated(1),
  { type: "move.failed", attempt: 2, error: "Session is locked" },
] satisfies WorkspaceMoveEvent[]

describe("transitionWorkspaceMove", () => {
  test("a move that fails after the worktree exists offers to retry or delete it instead of forgetting it", () => {
    const create = transitionWorkspaceMove(mounted, createRequested)

    expect(create.effects).toEqual([
      { type: "run-create", attempt: 1, sourceDirectory: root, timeoutMs: WORKSPACE_CREATE_TIMEOUT_MS },
    ])

    const move = transitionWorkspaceMove(create.state, worktreeCreated(1))

    expect(move.effects).toEqual([
      { type: "abort-op", attempt: 1 },
      { type: "run-move", attempt: 2, directory: created, syncLocation: true, timeoutMs: WORKSPACE_MOVE_TIMEOUT_MS },
    ])

    const failed = transitionWorkspaceMove(move.state, failedMove[2])

    expect(failed.state).toMatchObject({
      status: "recovering",
      dialog: 3,
      created: { projectID: project.id, directory: created },
      reason: { type: "failed", error: "Session is locked" },
    })
    expect(failed.effects).toEqual([
      { type: "abort-op", attempt: 2 },
      { type: "open-dialog", attempt: 3 },
    ])
    expect(workspaceDialogView(failed.state, 3, false)).toEqual({
      directory: created,
      reason: { type: "failed", error: "Session is locked" },
      running: false,
      retrying: false,
      removing: false,
      retryDisabled: false,
      removeDisabled: false,
    })
  })

  test("Retry moves into the worktree already created, keeps the error shown, and closes the dialog once moved", () => {
    const retry = replay([...failedMove, { type: "recovery.retry", attempt: 3, running: false }])

    expect(retry.effects).toEqual([
      { type: "run-move", attempt: 4, directory: created, syncLocation: true, timeoutMs: WORKSPACE_MOVE_TIMEOUT_MS },
    ])
    expect(workspaceDialogView(retry.state, 3, false)).toMatchObject({
      reason: { type: "failed", error: "Session is locked" },
      retrying: true,
      retryDisabled: true,
      removeDisabled: true,
    })

    const moved = transitionWorkspaceMove(retry.state, { type: "move.succeeded", attempt: 4 })

    expect(moved.effects).toEqual([
      { type: "abort-op", attempt: 4 },
      { type: "close-dialog", attempt: 3 },
    ])
    expect(moved.state).toMatchObject({ status: "idle", mounts: 1 })
  })

  test("Delete worktree force-removes the created worktree and closes the dialog", () => {
    const remove = replay([...failedMove, { type: "recovery.remove", attempt: 3 }])

    expect(remove.effects).toEqual([
      {
        type: "run-remove",
        attempt: 4,
        projectID: project.id,
        directory: created,
        timeoutMs: WORKSPACE_REMOVE_TIMEOUT_MS,
      },
    ])
    expect(workspaceDialogView(remove.state, 3, false)).toMatchObject({ removing: true, retryDisabled: true })

    const removed = transitionWorkspaceMove(remove.state, { type: "remove.succeeded", attempt: 4 })

    expect(removed.effects).toEqual([
      { type: "abort-op", attempt: 4 },
      { type: "close-dialog", attempt: 3 },
    ])
    expect(removed.state.status).toBe("idle")
  })

  test("a retry or removal that fails in the open dialog shows the new failure there, without a toast", () => {
    const retried = replay([
      ...failedMove,
      { type: "recovery.retry", attempt: 3, running: false },
      { type: "op.timed-out", attempt: 4 },
    ])

    expect(retried.effects).toEqual([{ type: "abort-op", attempt: 4 }])
    expect(retried.state).toMatchObject({ status: "recovering", dialog: 3, reason: { type: "timed-out" } })

    const removed = replay(
      [
        { type: "recovery.remove", attempt: 3 },
        { type: "remove.failed", attempt: 5, error: "Directory busy" },
      ],
      retried.state,
    )

    expect(removed.effects).toEqual([{ type: "abort-op", attempt: 5 }])
    expect(removed.state).toMatchObject({
      status: "recovering",
      dialog: 3,
      reason: { type: "failed", error: "Directory busy" },
    })
  })

  test("closing the dialog keeps the worktree and ends the controller once no menu is mounted", () => {
    const closed = replay([...failedMove, { type: "dialog.dismissed", attempt: 3 }])

    expect(closed.state).toMatchObject({ status: "idle", mounts: 1 })
    expect(closed.effects).toEqual([])

    const unmounted = replay([{ type: "unmounted" }, ...failedMove, { type: "dialog.dismissed", attempt: 3 }])

    expect(unmounted.state).toEqual({ status: "disposed" })
  })

  test("a retry or removal the user stopped watching finishes, and a late failure toasts", () => {
    const retry = replay([
      ...failedMove,
      { type: "recovery.retry", attempt: 3, running: false },
      { type: "dialog.dismissed", attempt: 3 },
    ])

    expect(retry.state).toMatchObject({ status: "moving", attempt: 4, dialog: { status: "dismissed" } })
    expect(workspaceDialogView(retry.state, 3, false)).toBeUndefined()

    const failed = transitionWorkspaceMove(retry.state, { type: "move.failed", attempt: 4, error: "Offline" })

    expect(failed.effects).toEqual([
      { type: "abort-op", attempt: 4 },
      { type: "toast", kind: "move", reason: { type: "failed", error: "Offline" } },
    ])
    expect(failed.state.status).toBe("idle")

    const remove = replay([
      ...failedMove,
      { type: "recovery.remove", attempt: 3 },
      { type: "dialog.dismissed", attempt: 3 },
      { type: "op.timed-out", attempt: 4 },
    ])

    expect(remove.effects).toEqual([
      { type: "abort-op", attempt: 4 },
      { type: "toast", kind: "remove", reason: { type: "timed-out" } },
    ])
    expect(remove.state.status).toBe("idle")

    const removed = replay([
      ...failedMove,
      { type: "recovery.remove", attempt: 3 },
      { type: "dialog.dismissed", attempt: 3 },
      { type: "remove.succeeded", attempt: 4 },
    ])

    expect(removed.effects).toEqual([{ type: "abort-op", attempt: 4 }])
  })

  test("a session that starts running while the worktree is created stays put, and Retry waits for the run", () => {
    const running = replay([createRequested, worktreeCreated(1, true)])

    expect(running.effects).toEqual([
      { type: "abort-op", attempt: 1 },
      { type: "open-dialog", attempt: 2 },
    ])
    expect(running.state).toMatchObject({ status: "recovering", dialog: 2, reason: { type: "running" } })
    expect(workspaceDialogView(running.state, 2, true)).toMatchObject({ running: true, retryDisabled: true })
    expect(workspaceDialogView(running.state, 2, false)).toMatchObject({ running: false, retryDisabled: false })

    const early = transitionWorkspaceMove(running.state, { type: "recovery.retry", attempt: 2, running: true })

    expect(early.state).toBe(running.state)
    expect(early.effects).toEqual([])
  })

  test("a session that starts running before session.move is sent is not moved", () => {
    const created = replay([createRequested, worktreeCreated(1), { type: "move.blocked", attempt: 2 }])

    expect(created.state).toMatchObject({ status: "recovering", reason: { type: "running" } })
    expect(created.effects).toEqual([
      { type: "abort-op", attempt: 2 },
      { type: "open-dialog", attempt: 3 },
    ])

    const existing = replay([
      { type: "move.requested", target: { type: "existing", directory: `${root}-feature` }, running: false },
      { type: "move.blocked", attempt: 1 },
    ])

    expect(existing.effects).toEqual([
      { type: "abort-op", attempt: 1 },
      { type: "toast", kind: "move", reason: { type: "running" } },
    ])
    expect(existing.state.status).toBe("idle")
  })

  test("a move survives the menu that started it and blocks a second move from the next menu", () => {
    const closed = replay([createRequested, { type: "unmounted" }])

    expect(closed.state).toMatchObject({ status: "creating", mounts: 0 })

    const reopened = transitionWorkspaceMove(closed.state, { type: "mounted" }).state

    expect(workspaceMenuView(reopened, root, project, false).disabled).toBe(true)

    const second = transitionWorkspaceMove(reopened, createRequested)

    expect(second.state).toBe(reopened)
    expect(second.effects).toEqual([])
  })

  test("an older worktree list never replaces a newer one, and the menu's refresh still runs once", () => {
    const opened = transitionWorkspaceMove(mounted, { type: "menu.opened", projectID: project.id })

    expect(opened.effects).toEqual([
      { type: "list-worktrees", attempt: 1, projectID: project.id, timeoutMs: WORKSPACE_LIST_TIMEOUT_MS },
    ])

    const updated = transitionWorkspaceMove(opened.state, { type: "worktree.updated", projectID: project.id })

    expect(updated.effects).toEqual([
      { type: "abort-list", attempt: 1 },
      { type: "list-worktrees", attempt: 2, projectID: project.id, timeoutMs: WORKSPACE_LIST_TIMEOUT_MS },
    ])

    const stale = transitionWorkspaceMove(updated.state, {
      type: "list.loaded",
      attempt: 1,
      items: [{ directory: root }, { directory: `${root}/stale` }],
    })

    expect(stale.state).toBe(updated.state)

    const fresh = transitionWorkspaceMove(updated.state, {
      type: "list.loaded",
      attempt: 2,
      items: [{ directory: root }, { directory: `${root}/fresh` }],
    })

    expect(fresh.effects).toEqual([
      { type: "abort-list", attempt: 2 },
      { type: "refresh-worktrees", projectID: project.id },
    ])
    expect(workspaceMenuView(fresh.state, root, project, false).workspaces).toEqual([`${root}/fresh`])
  })

  test("a failed list keeps the worktrees the menu already shows", () => {
    const listed = replay([
      { type: "menu.opened", projectID: project.id },
      { type: "list.loaded", attempt: 1, items: [{ directory: `${root}/kept` }] },
      { type: "worktree.updated", projectID: project.id },
      { type: "list.failed", attempt: 2 },
    ])

    expect(listed.effects).toEqual([{ type: "abort-list", attempt: 2 }])
    expect(workspaceMenuView(listed.state, root, project, false).workspaces).toEqual([`${root}/kept`])
  })

  test("another project's worktree changes and a list for another project are ignored or reset the inventory", () => {
    const listed = replay([
      { type: "menu.opened", projectID: project.id },
      { type: "list.loaded", attempt: 1, items: [{ directory: `${root}/kept` }] },
    ])

    const other = transitionWorkspaceMove(listed.state, { type: "worktree.updated", projectID: "proj_other" })

    expect(other.state).toBe(listed.state)

    const switched = transitionWorkspaceMove(listed.state, { type: "menu.opened", projectID: "proj_other" })

    expect(switched.state).toMatchObject({ projectID: "proj_other", directories: undefined })
    // The project the menu shows now falls back to its own worktrees until its list arrives.
    expect(
      workspaceMenuView(switched.state, "D:/other", { id: "proj_other", worktree: "D:/other" }, false).workspaces,
    ).toEqual([])
  })

  test("the dialog closes when the session reaches the worktree or the worktree goes away elsewhere", () => {
    const recovering = replay(failedMove).state

    const moved = transitionWorkspaceMove(recovering, { type: "session.moved", directory: created.toUpperCase() })

    expect(moved.effects).toEqual([{ type: "close-dialog", attempt: 3 }])
    expect(moved.state.status).toBe("idle")
    expect(transitionWorkspaceMove(recovering, { type: "session.moved", directory: root }).state).toBe(recovering)

    const gone = replay(
      [
        { type: "worktree.updated", projectID: project.id },
        { type: "list.loaded", attempt: 4, items: [{ directory: root }] },
      ],
      recovering,
    )

    expect(gone.effects).toEqual([
      { type: "abort-list", attempt: 4 },
      { type: "close-dialog", attempt: 3 },
    ])
    expect(gone.state.status).toBe("idle")
  })

  test("a list issued before the dialog opened cannot close it, as it may predate the worktree", () => {
    const listing = replay([{ type: "menu.opened", projectID: project.id }, ...failedMove.map(shift)])

    expect(listing.state).toMatchObject({ status: "recovering", dialog: 4 })

    const old = transitionWorkspaceMove(listing.state, { type: "list.loaded", attempt: 1, items: [{ directory: root }] })

    expect(old.state).toMatchObject({ status: "recovering", directories: [root] })
    expect(old.effects).toEqual([
      { type: "abort-list", attempt: 1 },
      { type: "refresh-worktrees", projectID: project.id },
    ])
  })

  test("creating, moving and removing each time out into a state the user can act on", () => {
    const create = replay([createRequested, { type: "op.timed-out", attempt: 1 }])

    expect(create.effects).toEqual([
      { type: "abort-op", attempt: 1 },
      { type: "toast", kind: "move", reason: { type: "timed-out" } },
    ])
    expect(create.state.status).toBe("idle")

    const failedCreate = replay([createRequested, { type: "create.failed", attempt: 1, error: "No git" }])

    expect(failedCreate.effects).toEqual([
      { type: "abort-op", attempt: 1 },
      { type: "toast", kind: "move", reason: { type: "failed", error: "No git" } },
    ])

    const existing = replay([
      { type: "move.requested", target: { type: "existing", directory: root }, running: false },
      { type: "op.timed-out", attempt: 1 },
    ])

    expect(existing.effects).toEqual([
      { type: "abort-op", attempt: 1 },
      { type: "toast", kind: "move", reason: { type: "timed-out" } },
    ])

    const createdMove = replay([createRequested, worktreeCreated(1), { type: "op.timed-out", attempt: 2 }])

    expect(createdMove.state).toMatchObject({ status: "recovering", reason: { type: "timed-out" } })
  })

  test("results of attempts the state no longer holds change nothing", () => {
    const moving = replay([createRequested, worktreeCreated(1)]).state
    const recovering = replay(failedMove).state

    for (const [state, event] of [
      [moving, worktreeCreated(1)],
      [moving, { type: "create.failed", attempt: 1, error: "late" }],
      [moving, { type: "op.timed-out", attempt: 1 }],
      [moving, { type: "move.succeeded", attempt: 9 }],
      [recovering, { type: "move.failed", attempt: 2, error: "late" }],
      [recovering, { type: "move.succeeded", attempt: 2 }],
      [recovering, { type: "remove.succeeded", attempt: 2 }],
      [recovering, { type: "dialog.dismissed", attempt: 9 }],
      [recovering, { type: "recovery.retry", attempt: 9, running: false }],
      [recovering, createRequested],
      [mounted, { type: "list.loaded", attempt: 9, items: [] }],
      [mounted, { type: "move.requested", target: { type: "existing", directory: root }, running: true }],
    ] satisfies [WorkspaceMoveState, WorkspaceMoveEvent][]) {
      const next = transitionWorkspaceMove(state, event)

      expect(next.state).toBe(state)
      expect(next.effects).toEqual([])
    }
  })

  test("the plugin's end aborts the work in flight and closes the dialog", () => {
    const retrying = replay([
      ...failedMove,
      { type: "worktree.updated", projectID: project.id },
      { type: "recovery.retry", attempt: 3, running: false },
    ])

    expect(transitionWorkspaceMove(retrying.state, { type: "disposed" })).toEqual({
      state: { status: "disposed" },
      effects: [
        { type: "abort-op", attempt: 5 },
        { type: "abort-list", attempt: 4 },
        { type: "close-dialog", attempt: 3 },
      ],
    })

    const disposed = transitionWorkspaceMove(retrying.state, { type: "disposed" }).state

    expect(transitionWorkspaceMove(disposed, { type: "move.succeeded", attempt: 5 }).state).toBe(disposed)
  })

  test("the last menu to unmount while idle ends the controller and its list", () => {
    const listing = replay([{ type: "menu.opened", projectID: project.id }, { type: "unmounted" }])

    expect(listing).toEqual({ state: { status: "disposed" }, effects: [{ type: "abort-list", attempt: 1 }] })
  })
})

describe("workspaceMenuView", () => {
  test("names the destinations other than the root and the worktree that holds the session", () => {
    const listed = replay([
      { type: "menu.opened", projectID: project.id },
      {
        type: "list.loaded",
        attempt: 1,
        items: [
          { directory: root },
          { directory: "C:/OpenCode/repo-feature" },
          { directory: "c:/opencode/REPO-FEATURE" },
          { directory: "C:/OpenCode/repo-other" },
        ],
      },
    ]).state

    expect(workspaceMenuView(listed, "C:/OpenCode/repo-feature/packages/app", project, false)).toEqual({
      disabled: false,
      showLocal: true,
      workspaces: ["C:/OpenCode/repo-other"],
    })
    expect(workspaceMenuView(listed, "c:/opencode/repo", project, false)).toMatchObject({
      showLocal: false,
      workspaces: ["C:/OpenCode/repo-feature", "C:/OpenCode/repo-other"],
    })
    expect(workspaceMenuView(listed, root, project, true).disabled).toBe(true)
  })

  test("falls back to the project's worktrees until a list settles", () => {
    expect(
      workspaceMenuView(
        mounted,
        root,
        { ...project, sandboxes: [root], worktrees: [{ directory: `${root}-feature` }, { directory: `${root}-disk` }] },
        false,
      ).workspaces,
    ).toEqual([`${root}-feature`, `${root}-disk`])
  })
})

// Shifts each attempt by one, for a sequence replayed after a list took the first attempt.
function shift(event: WorkspaceMoveEvent): WorkspaceMoveEvent {
  return "attempt" in event ? { ...event, attempt: event.attempt + 1 } : event
}

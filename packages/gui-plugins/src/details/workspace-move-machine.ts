import { containsDirectory, sameDirectory } from "@opencode/util/path"
import { workspaceDirectories, type WorkspaceProject } from "./paths"

/** How long `worktree.list` may run before the menu keeps the worktrees it already shows. */
export const WORKSPACE_LIST_TIMEOUT_MS = 15_000

/** How long `worktree.create` may run, including the project's start command (often a dependency install). */
export const WORKSPACE_CREATE_TIMEOUT_MS = 5 * 60_000

/** How long `location.syncInfo` plus `session.move` may run. */
export const WORKSPACE_MOVE_TIMEOUT_MS = 30_000

/** How long `worktree.remove` may run; a forced removal deletes every file in the checkout. */
export const WORKSPACE_REMOVE_TIMEOUT_MS = 2 * 60_000

/** A worktree this controller created that has not received the session yet. */
export type CreatedWorktree = {
  readonly projectID: string
  readonly directory: string
}

/** Why the session did not move into a created worktree, or why deleting that worktree failed. */
export type WorkspaceMoveFailure =
  | { readonly type: "failed"; readonly error: string }
  | { readonly type: "timed-out" }
  /** The session started running, so moving it would pull its checkout away mid-run. */
  | { readonly type: "running" }

export type WorkspaceMoveTarget =
  | { readonly type: "existing"; readonly directory: string }
  | { readonly type: "create"; readonly sourceDirectory: string }

type WorkspaceMoveBase = {
  /** The workspace menus that show this session's destinations. */
  readonly mounts: number
  /** The last attempt number handed out to a list, create, move, remove or recovery dialog. */
  readonly issued: number
  /** The project `directories` and `listing` belong to. */
  readonly projectID: string
  /** The server's worktrees for `projectID`, or undefined before a list settled. */
  readonly directories: readonly string[] | undefined
  /** The `worktree.list` in flight; `refresh` runs `worktree.refresh` once it settles. */
  readonly listing: { readonly attempt: number; readonly refresh: boolean } | undefined
}

/**
 * Moving one session to another worktree, shared by every workspace menu of the session. It lives while a menu is
 * mounted, a create, move or remove runs, or the recovery dialog shows. Results carry the attempt they answer, so a
 * result whose attempt the state no longer holds is stale.
 */
export type WorkspaceMoveState =
  | (WorkspaceMoveBase & { readonly status: "idle" })
  | (WorkspaceMoveBase & { readonly status: "creating"; readonly attempt: number })
  | (WorkspaceMoveBase & {
      readonly status: "moving"
      readonly attempt: number
      readonly destination: string
      /** Set when the destination is a worktree this controller created. */
      readonly created: CreatedWorktree | undefined
      /** The recovery dialog a retry runs from; undefined for the first move. */
      readonly dialog: RecoveryDialog | undefined
    })
  /** The recovery dialog offers to retry the move or delete the created worktree. */
  | (WorkspaceMoveBase & {
      readonly status: "recovering"
      readonly dialog: number
      readonly created: CreatedWorktree
      readonly reason: WorkspaceMoveFailure
    })
  | (WorkspaceMoveBase & {
      readonly status: "removing"
      readonly attempt: number
      readonly created: CreatedWorktree
      readonly dialog: RecoveryDialog
    })
  | { readonly status: "disposed" }

/** The recovery dialog a retry or removal runs from. */
export type RecoveryDialog =
  /** It keeps showing `reason` until the action settles. */
  | { readonly status: "open"; readonly attempt: number; readonly reason: WorkspaceMoveFailure }
  /** The user closed it while the action kept running; a late failure toasts instead. */
  | { readonly status: "dismissed" }

export type WorkspaceMoveEvent =
  /** A workspace menu mounted or unmounted. */
  | { readonly type: "mounted" }
  | { readonly type: "unmounted" }
  /** The destinations submenu opened: list the worktrees again, then let the server discover new ones. */
  | { readonly type: "menu.opened"; readonly projectID: string }
  /** The server reported that a project's worktrees changed. */
  | { readonly type: "worktree.updated"; readonly projectID: string }
  | { readonly type: "list.loaded"; readonly attempt: number; readonly items: readonly { readonly directory: string }[] }
  /** The list failed or timed out. */
  | { readonly type: "list.failed"; readonly attempt: number }
  /** `running` is the session's status when the user picked the destination. */
  | { readonly type: "move.requested"; readonly target: WorkspaceMoveTarget; readonly running: boolean }
  /** `running` is the session's status when the worktree was created. */
  | {
      readonly type: "worktree.created"
      readonly attempt: number
      readonly projectID: string
      readonly directory: string
      readonly running: boolean
    }
  | { readonly type: "create.failed"; readonly attempt: number; readonly error: string }
  | { readonly type: "move.succeeded"; readonly attempt: number }
  | { readonly type: "move.failed"; readonly attempt: number; readonly error: string }
  /** The session started running before `session.move` was sent, so it was not sent. */
  | { readonly type: "move.blocked"; readonly attempt: number }
  /** The recovery dialog's Retry; `running` is the session's status at the click. */
  | { readonly type: "recovery.retry"; readonly attempt: number; readonly running: boolean }
  /** The recovery dialog's Delete worktree. */
  | { readonly type: "recovery.remove"; readonly attempt: number }
  | { readonly type: "remove.succeeded"; readonly attempt: number }
  | { readonly type: "remove.failed"; readonly attempt: number; readonly error: string }
  /** The create, move or remove of `attempt` ran out of time. */
  | { readonly type: "op.timed-out"; readonly attempt: number }
  /** The recovery dialog closed, by the user or by the controller. */
  | { readonly type: "dialog.dismissed"; readonly attempt: number }
  /** The session's directory, as the server reports it; it changes when the session moves, from here or elsewhere. */
  | { readonly type: "session.moved"; readonly directory: string }
  | { readonly type: "disposed" }

export type WorkspaceMoveEffect =
  /** Starts the list's controller and timeout, then lists the project's worktrees. */
  | { readonly type: "list-worktrees"; readonly attempt: number; readonly projectID: string; readonly timeoutMs: number }
  /** Ends the list's controller and timeout. */
  | { readonly type: "abort-list"; readonly attempt: number }
  | { readonly type: "refresh-worktrees"; readonly projectID: string }
  /** Starts the attempt's controller and timeout, then creates a worktree from the session's project. */
  | {
      readonly type: "run-create"
      readonly attempt: number
      readonly sourceDirectory: string
      readonly timeoutMs: number
    }
  /** Starts the attempt's controller and timeout, then moves the session unless it started running. */
  | {
      readonly type: "run-move"
      readonly attempt: number
      readonly directory: string
      /** Loads the destination's location first, as a newly created worktree is not in the client's cache yet. */
      readonly syncLocation: boolean
      readonly timeoutMs: number
    }
  /** Starts the attempt's controller and timeout, then force-removes the created worktree. */
  | {
      readonly type: "run-remove"
      readonly attempt: number
      readonly projectID: string
      readonly directory: string
      readonly timeoutMs: number
    }
  /** Ends the attempt's controller and timeout. */
  | { readonly type: "abort-op"; readonly attempt: number }
  | { readonly type: "open-dialog"; readonly attempt: number }
  | { readonly type: "close-dialog"; readonly attempt: number }
  /** Reports a failure no dialog shows: a move into an existing worktree, or one the user stopped watching. */
  | { readonly type: "toast"; readonly kind: "move" | "remove"; readonly reason: WorkspaceMoveFailure }

export type WorkspaceMoveTransition = {
  readonly state: WorkspaceMoveState
  readonly effects: readonly WorkspaceMoveEffect[]
}

/** A fresh state per controller: never shared, so no two controllers can write into one object. */
export function createWorkspaceMoveState(projectID: string): WorkspaceMoveState {
  return { status: "idle", mounts: 0, issued: 0, projectID, directories: undefined, listing: undefined }
}

const NONE: readonly WorkspaceMoveEffect[] = []

const DISMISSED: RecoveryDialog = { status: "dismissed" }

type Live = Exclude<WorkspaceMoveState, { status: "disposed" }>

type Step = Exclude<WorkspaceMoveEvent, { type: "disposed" }>

export function transitionWorkspaceMove(state: WorkspaceMoveState, event: WorkspaceMoveEvent): WorkspaceMoveTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed") {
    const dialog = openDialog(state)

    return {
      state: { status: "disposed" },
      effects: [
        ...(state.status === "creating" || state.status === "moving" || state.status === "removing"
          ? [{ type: "abort-op", attempt: state.attempt } as const]
          : NONE),
        ...abortList(state.listing),
        ...(dialog === undefined ? NONE : [{ type: "close-dialog", attempt: dialog } as const]),
      ],
    }
  }

  const next = step(state, event)

  return next.state === state ? next : release(next)
}

/** What a workspace menu shows. */
export type WorkspaceMenuView = {
  /** The trigger and every item take no input while a move runs, the dialog shows, or the session runs. */
  readonly disabled: boolean
  /** Offer the project's root checkout: the session is somewhere else. */
  readonly showLocal: boolean
  /** The project's other worktrees, without the one that holds the session's directory. */
  readonly workspaces: readonly string[]
}

export function workspaceMenuView(
  state: WorkspaceMoveState,
  directory: string,
  project: WorkspaceProject & { readonly id: string },
  running: boolean,
): WorkspaceMenuView {
  const listed =
    state.status !== "disposed" && state.projectID === project.id && state.directories !== undefined
      ? state.directories
      : workspaceDirectories(project)

  const others = listed.filter(
    (item, index) =>
      !sameDirectory(project.worktree, item) &&
      listed.findIndex((candidate) => sameDirectory(candidate, item)) === index,
  )

  const current = others.find((item) => containsDirectory(item, directory)) ?? directory

  return {
    disabled: state.status !== "idle" || running,
    showLocal: !sameDirectory(directory, project.worktree),
    workspaces: others.filter((item) => !sameDirectory(item, current)),
  }
}

/** What the recovery dialog shows. */
export type WorkspaceDialogView = {
  /** The created worktree. */
  readonly directory: string
  /** The latest failure, kept while a retry or removal runs. */
  readonly reason: WorkspaceMoveFailure
  readonly running: boolean
  readonly retrying: boolean
  readonly removing: boolean
  /** Retry waits for the session to stop running and for the action in flight. */
  readonly retryDisabled: boolean
  readonly removeDisabled: boolean
}

/** What the recovery dialog of `attempt` shows, or undefined once it closed. */
export function workspaceDialogView(
  state: WorkspaceMoveState,
  attempt: number,
  running: boolean,
): WorkspaceDialogView | undefined {
  if (state.status === "recovering" && state.dialog === attempt)
    return view(state.created.directory, state.reason, running, { retrying: false, removing: false })

  if (state.status !== "moving" && state.status !== "removing") return
  const dialog = state.dialog

  if (dialog?.status !== "open" || dialog.attempt !== attempt) return

  if (state.status === "removing")
    return view(state.created.directory, dialog.reason, running, { retrying: false, removing: true })

  return view(state.destination, dialog.reason, running, { retrying: true, removing: false })
}

function view(
  directory: string,
  reason: WorkspaceMoveFailure,
  running: boolean,
  busy: { readonly retrying: boolean; readonly removing: boolean },
): WorkspaceDialogView {
  const pending = busy.retrying || busy.removing

  return {
    directory,
    reason,
    running,
    retrying: busy.retrying,
    removing: busy.removing,
    retryDisabled: pending || running,
    removeDisabled: pending,
  }
}

function step(state: Live, event: Step): WorkspaceMoveTransition {
  if (event.type === "mounted") return { state: { ...state, mounts: state.mounts + 1 }, effects: NONE }

  if (event.type === "unmounted") return { state: { ...state, mounts: Math.max(0, state.mounts - 1) }, effects: NONE }

  if (event.type === "menu.opened") {
    const attempt = state.issued + 1

    return {
      state: {
        ...state,
        issued: attempt,
        projectID: event.projectID,
        directories: event.projectID === state.projectID ? state.directories : undefined,
        listing: { attempt, refresh: true },
      },
      effects: [
        ...abortList(state.listing),
        { type: "list-worktrees", attempt, projectID: event.projectID, timeoutMs: WORKSPACE_LIST_TIMEOUT_MS },
      ],
    }
  }

  if (event.type === "worktree.updated") {
    if (event.projectID !== state.projectID) return { state, effects: NONE }
    const attempt = state.issued + 1

    return {
      state: { ...state, issued: attempt, listing: { attempt, refresh: state.listing?.refresh ?? false } },
      effects: [
        ...abortList(state.listing),
        { type: "list-worktrees", attempt, projectID: state.projectID, timeoutMs: WORKSPACE_LIST_TIMEOUT_MS },
      ],
    }
  }

  if (event.type === "list.loaded" || event.type === "list.failed") return listed(state, event)

  if (event.type === "session.moved") {
    // The session reached the created worktree some other way, e.g. from another window.
    if (state.status !== "recovering" || !sameDirectory(state.created.directory, event.directory))
      return { state, effects: NONE }

    return { state: idle(state), effects: [{ type: "close-dialog", attempt: state.dialog }] }
  }

  if (state.status === "idle") return requested(state, event)

  if (state.status === "creating") return creating(state, event)

  if (state.status === "moving") return moving(state, event)

  if (state.status === "recovering") return recovering(state, event)

  return removing(state, event)
}

function listed(
  state: Live,
  event: Extract<WorkspaceMoveEvent, { type: "list.loaded" | "list.failed" }>,
): WorkspaceMoveTransition {
  const listing = state.listing

  if (listing?.attempt !== event.attempt) return { state, effects: NONE }
  const effects: WorkspaceMoveEffect[] = [{ type: "abort-list", attempt: event.attempt }]

  if (event.type === "list.failed") return { state: { ...state, listing: undefined }, effects }

  if (listing.refresh) effects.push({ type: "refresh-worktrees", projectID: state.projectID })
  const next = { ...state, listing: undefined, directories: event.items.map((item) => item.directory) }

  // The created worktree is gone, e.g. deleted from Settings. Only a list issued after the dialog opened can say so: an
  // older one may predate the worktree.
  const gone =
    state.status === "recovering" &&
    event.attempt > state.dialog &&
    state.created.projectID === state.projectID &&
    !event.items.some((item) => sameDirectory(item.directory, state.created.directory))

  if (!gone) return { state: next, effects }

  return { state: idle(next), effects: [...effects, { type: "close-dialog", attempt: state.dialog }] }
}

function requested(state: Extract<Live, { status: "idle" }>, event: Step): WorkspaceMoveTransition {
  if (event.type !== "move.requested" || event.running) return { state, effects: NONE }
  const attempt = state.issued + 1
  const target = event.target

  if (target.type === "create")
    return {
      state: { ...state, status: "creating", issued: attempt, attempt },
      effects: [
        {
          type: "run-create",
          attempt,
          sourceDirectory: target.sourceDirectory,
          timeoutMs: WORKSPACE_CREATE_TIMEOUT_MS,
        },
      ],
    }

  return {
    state: {
      ...state,
      status: "moving",
      issued: attempt,
      attempt,
      destination: target.directory,
      created: undefined,
      dialog: undefined,
    },
    effects: [
      {
        type: "run-move",
        attempt,
        directory: target.directory,
        syncLocation: false,
        timeoutMs: WORKSPACE_MOVE_TIMEOUT_MS,
      },
    ],
  }
}

function creating(state: Extract<Live, { status: "creating" }>, event: Step): WorkspaceMoveTransition {
  if (!("attempt" in event) || event.attempt !== state.attempt) return { state, effects: NONE }
  const abort: WorkspaceMoveEffect = { type: "abort-op", attempt: state.attempt }

  if (event.type === "worktree.created") {
    const attempt = state.issued + 1
    const created = { projectID: event.projectID, directory: event.directory }

    // The session started running while the worktree was created: keep it where it runs, and offer the worktree.
    if (event.running)
      return {
        state: {
          ...base(state),
          status: "recovering",
          issued: attempt,
          dialog: attempt,
          created,
          reason: { type: "running" },
        },
        effects: [abort, { type: "open-dialog", attempt }],
      }

    return {
      state: {
        ...base(state),
        status: "moving",
        issued: attempt,
        attempt,
        destination: event.directory,
        created,
        dialog: undefined,
      },
      effects: [
        abort,
        {
          type: "run-move",
          attempt,
          directory: event.directory,
          syncLocation: true,
          timeoutMs: WORKSPACE_MOVE_TIMEOUT_MS,
        },
      ],
    }
  }

  if (event.type === "create.failed")
    return {
      state: idle(state),
      effects: [abort, { type: "toast", kind: "move", reason: { type: "failed", error: event.error } }],
    }

  if (event.type === "op.timed-out")
    return { state: idle(state), effects: [abort, { type: "toast", kind: "move", reason: { type: "timed-out" } }] }

  return { state, effects: NONE }
}

function moving(state: Extract<Live, { status: "moving" }>, event: Step): WorkspaceMoveTransition {
  const dialog = state.dialog

  if (event.type === "dialog.dismissed") {
    if (dialog?.status !== "open" || event.attempt !== dialog.attempt) return { state, effects: NONE }

    // The retry keeps running; a late failure toasts instead of opening the dialog again.
    return { state: { ...state, dialog: DISMISSED }, effects: NONE }
  }

  if (!("attempt" in event) || event.attempt !== state.attempt) return { state, effects: NONE }
  const abort: WorkspaceMoveEffect = { type: "abort-op", attempt: state.attempt }

  if (event.type === "move.succeeded") return { state: idle(state), effects: [abort, ...closeDialog(dialog)] }

  const reason = failure(event)

  if (!reason) return { state, effects: NONE }

  if (!state.created || dialog?.status === "dismissed")
    return { state: idle(state), effects: [abort, { type: "toast", kind: "move", reason }] }

  // A retry from the open dialog shows its failure in place.
  if (dialog?.status === "open")
    return {
      state: { ...base(state), status: "recovering", dialog: dialog.attempt, created: state.created, reason },
      effects: [abort],
    }

  const attempt = state.issued + 1

  return {
    state: { ...base(state), status: "recovering", issued: attempt, dialog: attempt, created: state.created, reason },
    effects: [abort, { type: "open-dialog", attempt }],
  }
}

function recovering(state: Extract<Live, { status: "recovering" }>, event: Step): WorkspaceMoveTransition {
  if (!("attempt" in event) || event.attempt !== state.dialog) return { state, effects: NONE }

  // Keep worktree, Escape, or the dialog closing for any other reason: the worktree stays, the session stays.
  if (event.type === "dialog.dismissed") return { state: idle(state), effects: NONE }

  if (event.type === "recovery.retry") {
    if (event.running) return { state, effects: NONE }
    const attempt = state.issued + 1

    return {
      state: {
        ...base(state),
        status: "moving",
        issued: attempt,
        attempt,
        destination: state.created.directory,
        created: state.created,
        dialog: { status: "open", attempt: state.dialog, reason: state.reason },
      },
      effects: [
        {
          type: "run-move",
          attempt,
          directory: state.created.directory,
          syncLocation: true,
          timeoutMs: WORKSPACE_MOVE_TIMEOUT_MS,
        },
      ],
    }
  }

  if (event.type !== "recovery.remove") return { state, effects: NONE }
  const attempt = state.issued + 1

  return {
    state: {
      ...base(state),
      status: "removing",
      issued: attempt,
      attempt,
      created: state.created,
      dialog: { status: "open", attempt: state.dialog, reason: state.reason },
    },
    effects: [
      {
        type: "run-remove",
        attempt,
        projectID: state.created.projectID,
        directory: state.created.directory,
        timeoutMs: WORKSPACE_REMOVE_TIMEOUT_MS,
      },
    ],
  }
}

function removing(state: Extract<Live, { status: "removing" }>, event: Step): WorkspaceMoveTransition {
  const dialog = state.dialog

  if (event.type === "dialog.dismissed") {
    if (dialog.status !== "open" || event.attempt !== dialog.attempt) return { state, effects: NONE }

    return { state: { ...state, dialog: DISMISSED }, effects: NONE }
  }

  if (!("attempt" in event) || event.attempt !== state.attempt) return { state, effects: NONE }
  const abort: WorkspaceMoveEffect = { type: "abort-op", attempt: state.attempt }
  const directory = state.created.directory

  if (event.type === "remove.succeeded")
    return {
      state: idle({ ...state, directories: state.directories?.filter((item) => !sameDirectory(item, directory)) }),
      effects: [abort, ...closeDialog(dialog)],
    }

  const reason = failure(event)

  if (!reason) return { state, effects: NONE }

  if (dialog.status === "dismissed")
    return { state: idle(state), effects: [abort, { type: "toast", kind: "remove", reason }] }

  return {
    state: { ...base(state), status: "recovering", dialog: dialog.attempt, created: state.created, reason },
    effects: [abort],
  }
}

// The controller ends once nothing uses it: no menu is mounted and no create, move, remove or dialog is open.
function release(transition: WorkspaceMoveTransition): WorkspaceMoveTransition {
  const state = transition.state

  if (state.status !== "idle" || state.mounts > 0) return transition

  return { state: { status: "disposed" }, effects: [...transition.effects, ...abortList(state.listing)] }
}

// Attempts are unique, so a failure that matches the state's attempt always answers the operation in flight.
function failure(event: Step): WorkspaceMoveFailure | undefined {
  if (event.type === "move.failed" || event.type === "remove.failed") return { type: "failed", error: event.error }

  if (event.type === "move.blocked") return { type: "running" }

  if (event.type === "op.timed-out") return { type: "timed-out" }
}

function base(state: Live): WorkspaceMoveBase {
  return {
    mounts: state.mounts,
    issued: state.issued,
    projectID: state.projectID,
    directories: state.directories,
    listing: state.listing,
  }
}

function idle(state: Live): WorkspaceMoveState {
  return { ...base(state), status: "idle" }
}

function openDialog(state: Live) {
  if (state.status === "recovering") return state.dialog

  if ((state.status === "moving" || state.status === "removing") && state.dialog?.status === "open")
    return state.dialog.attempt
}

function closeDialog(dialog: RecoveryDialog | undefined): readonly WorkspaceMoveEffect[] {
  return dialog?.status === "open" ? [{ type: "close-dialog", attempt: dialog.attempt }] : NONE
}

function abortList(listing: WorkspaceMoveBase["listing"]): readonly WorkspaceMoveEffect[] {
  return listing ? [{ type: "abort-list", attempt: listing.attempt }] : NONE
}

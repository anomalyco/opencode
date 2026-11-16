import type { Session } from "@opencode/schema/session"

type McpStates = Readonly<Record<string, boolean>>

// Outlasts the request queue's 10 minute budget for `POST /api/worktree`, which runs the project's setup script, so the
// phase only ends a create whose response stalled after that budget, never a slow setup script.
export const NEW_SESSION_WORKTREE_TIMEOUT_MS = 11 * 60_000

// Preparing waits for running MCP toggles (60 s each), then lists the servers, toggles them and lists them again.
export const NEW_SESSION_MCP_TIMEOUT_MS = 2 * 60_000

// Creating a Session is one small request. The prompt is sent only after it, so a create that lands later is empty.
export const NEW_SESSION_CREATE_TIMEOUT_MS = 30_000

export type NewSessionWorkspace =
  // The main checkout or a worktree that already exists.
  | { readonly type: "existing"; readonly directory: string }
  | { readonly type: "new"; readonly projectDirectory: string; readonly branch?: string }

// While an attempt is active its draft is shown as a pending session tab. `created` marks a directory that is a
// worktree this attempt created, which a rollback keeps as the draft's workspace.
export type NewSessionStartState =
  | { readonly type: "idle"; readonly attempt: number }
  | { readonly type: "worktree"; readonly attempt: number; readonly sessionID: Session.ID; readonly mcp: McpStates }
  | {
      readonly type: "mcp"
      readonly attempt: number
      readonly sessionID: Session.ID
      readonly directory: string
      readonly created: boolean
      readonly mcp: McpStates
    }
  | {
      readonly type: "session"
      readonly attempt: number
      readonly sessionID: Session.ID
      readonly directory: string
      readonly created: boolean
      readonly mcp: McpStates
    }
  | { readonly type: "started"; readonly attempt: number }
  | { readonly type: "disposed" }

type ActiveState = Extract<NewSessionStartState, { type: "worktree" | "mcp" | "session" }>

export type NewSessionStartEvent =
  | {
      readonly type: "start"
      readonly sessionID: Session.ID
      readonly workspace: NewSessionWorkspace
      readonly mcp: McpStates
      // An MCP toggle for the existing directory is still in flight.
      readonly toggling: boolean
    }
  | { readonly type: "worktree.created"; readonly attempt: number; readonly directory: string }
  | { readonly type: "worktree.failed"; readonly attempt: number; readonly message: string }
  // Without a message, the MCP controller already reported the failed toggle.
  | { readonly type: "mcp.prepared"; readonly attempt: number }
  | { readonly type: "mcp.failed"; readonly attempt: number; readonly message?: string }
  | { readonly type: "session.created"; readonly attempt: number }
  | { readonly type: "session.failed"; readonly attempt: number; readonly message: string }
  | { readonly type: "timed-out"; readonly attempt: number; readonly phase: ActiveState["type"] }
  | { readonly type: "dispose" }

type ToastTitle =
  | "prompt.toast.worktreeCreateFailed.title"
  | "session.summary.mcp.prepareFailed"
  | "prompt.toast.sessionCreateFailed.title"

export type NewSessionStartEffect =
  // Each phase's request carries the phase's time limit.
  | {
      readonly type: "worktree.create"
      readonly attempt: number
      readonly projectDirectory: string
      readonly branch?: string
      readonly timeoutMs: number
    }
  | {
      readonly type: "mcp.prepare"
      readonly attempt: number
      readonly directory: string
      readonly mcp: McpStates
      readonly timeoutMs: number
    }
  | {
      readonly type: "session.create"
      readonly attempt: number
      readonly sessionID: Session.ID
      readonly directory: string
      readonly timeoutMs: number
    }
  | {
      readonly type: "session.promote"
      readonly attempt: number
      readonly sessionID: Session.ID
      readonly directory: string
    }
  | { readonly type: "toast"; readonly attempt: number; readonly title: ToastTitle; readonly message: string }
  | { readonly type: "toast.timed-out"; readonly attempt: number; readonly title: ToastTitle }
  // Ends the attempt and restores the draft tab. A created worktree becomes the draft's workspace and keeps the MCP
  // choices.
  | {
      readonly type: "tab.rollback"
      readonly attempt: number
      readonly worktree?: { directory: string; mcp: McpStates }
    }
  // Ends the attempt without touching the tabs, which are being removed.
  | { readonly type: "attempt.abort"; readonly attempt: number }

export type NewSessionStartTransition = {
  readonly state: NewSessionStartState
  readonly effects: readonly NewSessionStartEffect[]
}

const TITLES = {
  worktree: "prompt.toast.worktreeCreateFailed.title",
  mcp: "session.summary.mcp.prepareFailed",
  session: "prompt.toast.sessionCreateFailed.title",
} satisfies Record<ActiveState["type"], ToastTitle>

export function createNewSessionStartState(): NewSessionStartState {
  return { type: "idle", attempt: 0 }
}

export function transitionNewSessionStart(
  state: NewSessionStartState,
  event: NewSessionStartEvent,
): NewSessionStartTransition {
  if (state.type === "disposed") return unchanged(state)

  if (event.type === "dispose")
    return changed(
      { type: "disposed" },
      isNewSessionStartActive(state) ? [{ type: "attempt.abort", attempt: state.attempt }] : [],
    )

  if (event.type === "start") return start(state, event)

  if (!isNewSessionStartActive(state) || event.attempt !== state.attempt) return unchanged(state)

  // A phase's timer only ends that phase; a later phase of the same attempt has its own.
  if (event.type === "timed-out") {
    if (event.phase !== state.type) return unchanged(state)

    return rollback(state, { type: "toast.timed-out", attempt: state.attempt, title: TITLES[state.type] })
  }

  if (state.type === "worktree" && event.type === "worktree.created") {
    return prepare(
      { attempt: state.attempt, sessionID: state.sessionID, directory: event.directory, created: true, mcp: state.mcp },
      false,
    )
  }

  if (state.type === "worktree" && event.type === "worktree.failed") return rollback(state, toast(state, event.message))

  if (state.type === "mcp" && event.type === "mcp.prepared") return create(state)

  if (state.type === "mcp" && event.type === "mcp.failed")
    return rollback(state, event.message === undefined ? undefined : toast(state, event.message))

  if (state.type === "session" && event.type === "session.created") {
    return changed({ type: "started", attempt: state.attempt }, [
      { type: "session.promote", attempt: state.attempt, sessionID: state.sessionID, directory: state.directory },
    ])
  }

  if (state.type === "session" && event.type === "session.failed") return rollback(state, toast(state, event.message))

  return unchanged(state)
}

export type NewSessionStartView = {
  // The pending session screen's status line.
  readonly status: "session.new.worktree.creating" | "session.new.starting"
  readonly preparingMcp: boolean
}

export function viewNewSessionStart(state: NewSessionStartState): NewSessionStartView {
  return {
    status: state.type === "worktree" ? "session.new.worktree.creating" : "session.new.starting",
    preparingMcp: state.type === "mcp",
  }
}

/** Whether an attempt is running and its effects still apply. */
export function isNewSessionStartActive(state: NewSessionStartState): state is ActiveState {
  return state.type === "worktree" || state.type === "mcp" || state.type === "session"
}

function start(
  state: NewSessionStartState,
  event: Extract<NewSessionStartEvent, { type: "start" }>,
): NewSessionStartTransition {
  if (state.type !== "idle") return unchanged(state)
  const attempt = state.attempt + 1

  if (event.workspace.type === "new") {
    return changed({ type: "worktree", attempt, sessionID: event.sessionID, mcp: event.mcp }, [
      {
        type: "worktree.create",
        attempt,
        projectDirectory: event.workspace.projectDirectory,
        branch: event.workspace.branch,
        timeoutMs: NEW_SESSION_WORKTREE_TIMEOUT_MS,
      },
    ])
  }

  return prepare(
    { attempt, sessionID: event.sessionID, directory: event.workspace.directory, created: false, mcp: event.mcp },
    event.toggling,
  )
}

type Target = Omit<Extract<NewSessionStartState, { type: "session" }>, "type">

// Skips MCP preparation when there is nothing to apply or wait for.
function prepare(target: Target, toggling: boolean): NewSessionStartTransition {
  if (!toggling && Object.keys(target.mcp).length === 0) return create(target)

  return changed({ ...target, type: "mcp" }, [
    {
      type: "mcp.prepare",
      attempt: target.attempt,
      directory: target.directory,
      mcp: target.mcp,
      timeoutMs: NEW_SESSION_MCP_TIMEOUT_MS,
    },
  ])
}

function create(target: Target): NewSessionStartTransition {
  return changed({ ...target, type: "session" }, [
    {
      type: "session.create",
      attempt: target.attempt,
      sessionID: target.sessionID,
      directory: target.directory,
      timeoutMs: NEW_SESSION_CREATE_TIMEOUT_MS,
    },
  ])
}

function toast(state: ActiveState, message: string): NewSessionStartEffect {
  return { type: "toast", attempt: state.attempt, title: TITLES[state.type], message }
}

function rollback(state: ActiveState, toast?: NewSessionStartEffect): NewSessionStartTransition {
  const worktree =
    state.type !== "worktree" && state.created ? { directory: state.directory, mcp: state.mcp } : undefined

  return changed({ type: "idle", attempt: state.attempt }, [
    ...(toast ? [toast] : []),
    { type: "tab.rollback", attempt: state.attempt, worktree },
  ])
}

function changed(
  state: NewSessionStartState,
  effects: readonly NewSessionStartEffect[] = [],
): NewSessionStartTransition {
  return { state, effects }
}

function unchanged(state: NewSessionStartState): NewSessionStartTransition {
  return { state, effects: [] }
}

import type { Session } from "@opencode/schema/session"

type McpStates = Readonly<Record<string, boolean>>

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
  | { readonly type: "mcp.prepared"; readonly attempt: number }
  | { readonly type: "mcp.failed"; readonly attempt: number }
  | { readonly type: "session.created"; readonly attempt: number }
  | { readonly type: "session.failed"; readonly attempt: number; readonly message: string }
  | { readonly type: "dispose" }

export type NewSessionStartEffect =
  | {
      readonly type: "worktree.create"
      readonly attempt: number
      readonly projectDirectory: string
      readonly branch?: string
    }
  | { readonly type: "mcp.prepare"; readonly attempt: number; readonly directory: string; readonly mcp: McpStates }
  | {
      readonly type: "session.create" | "session.promote"
      readonly attempt: number
      readonly sessionID: Session.ID
      readonly directory: string
    }
  | {
      readonly type: "toast"
      readonly attempt: number
      readonly title: "prompt.toast.worktreeCreateFailed.title" | "prompt.toast.sessionCreateFailed.title"
      readonly message: string
    }
  // Restores the draft tab. A created worktree becomes the draft's workspace and keeps the MCP choices.
  | {
      readonly type: "tab.rollback"
      readonly attempt: number
      readonly worktree?: { directory: string; mcp: McpStates }
    }
  | { readonly type: "attempt.abort"; readonly attempt: number }

export type NewSessionStartTransition = {
  readonly state: NewSessionStartState
  readonly effects: readonly NewSessionStartEffect[]
}

export function createNewSessionStartState(): NewSessionStartState {
  return { type: "idle", attempt: 0 }
}

export function transitionNewSessionStart(
  state: NewSessionStartState,
  event: NewSessionStartEvent,
): NewSessionStartTransition {
  if (state.type === "disposed") return unchanged(state)

  if (event.type === "dispose")
    return changed({ type: "disposed" }, active(state) ? [{ type: "attempt.abort", attempt: state.attempt }] : [])

  if (event.type === "start") return start(state, event)

  if (!active(state) || event.attempt !== state.attempt) return unchanged(state)

  if (state.type === "worktree" && event.type === "worktree.created") {
    return prepare(
      { attempt: state.attempt, sessionID: state.sessionID, directory: event.directory, created: true, mcp: state.mcp },
      false,
    )
  }

  if (state.type === "worktree" && event.type === "worktree.failed")
    return rollback(state, { title: "prompt.toast.worktreeCreateFailed.title", message: event.message })

  if (state.type === "mcp" && event.type === "mcp.prepared") return create(state)

  // MCP preparation shows its own error.
  if (state.type === "mcp" && event.type === "mcp.failed") return rollback(state)

  if (state.type === "session" && event.type === "session.created") {
    return changed({ type: "started", attempt: state.attempt }, [
      { type: "session.promote", attempt: state.attempt, sessionID: state.sessionID, directory: state.directory },
    ])
  }

  if (state.type === "session" && event.type === "session.failed")
    return rollback(state, { title: "prompt.toast.sessionCreateFailed.title", message: event.message })

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
    { type: "mcp.prepare", attempt: target.attempt, directory: target.directory, mcp: target.mcp },
  ])
}

function create(target: Target): NewSessionStartTransition {
  return changed({ ...target, type: "session" }, [
    { type: "session.create", attempt: target.attempt, sessionID: target.sessionID, directory: target.directory },
  ])
}

function rollback(
  state: ActiveState,
  toast?: Omit<Extract<NewSessionStartEffect, { type: "toast" }>, "type" | "attempt">,
): NewSessionStartTransition {
  const worktree =
    state.type !== "worktree" && state.created ? { directory: state.directory, mcp: state.mcp } : undefined

  return changed({ type: "idle", attempt: state.attempt }, [
    ...(toast ? [{ type: "toast" as const, attempt: state.attempt, ...toast }] : []),
    { type: "tab.rollback", attempt: state.attempt, worktree },
  ])
}

type ActiveState = Extract<NewSessionStartState, { type: "worktree" | "mcp" | "session" }>

function active(state: NewSessionStartState): state is ActiveState {
  return state.type === "worktree" || state.type === "mcp" || state.type === "session"
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

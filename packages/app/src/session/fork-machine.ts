import type { SessionInfo } from "@opencode/client/promise"
import type { ContextItem, Prompt } from "@/composer/schema"

export const FORK_TIMEOUT_MS = 30_000

/**
 * `dialog` is the /fork picker, which closes once its fork opens and stays disabled through its exit animation;
 * `inline` is the timeline's "Fork from here", which can fork again once one opens.
 */
export type SessionForkSurface = "dialog" | "inline"

/** The composer content the fork gets back: the prompt it was forked before, and that prompt's context. */
export type SessionForkDraft = {
  readonly prompt: Prompt
  readonly context: readonly ContextItem[]
}

export type SessionForkState =
  | { readonly status: "idle"; readonly surface: SessionForkSurface; readonly attempt: number }
  | {
      readonly status: "forking"
      readonly surface: SessionForkSurface
      readonly attempt: number
      readonly sessionID: string
      readonly messageID: string
      readonly draft: SessionForkDraft
    }
  | { readonly status: "closed"; readonly surface: SessionForkSurface; readonly attempt: number }

export type SessionForkEvent =
  | {
      readonly type: "fork.requested"
      readonly sessionID: string
      readonly messageID: string
      readonly draft: SessionForkDraft
    }
  | { readonly type: "fork.succeeded"; readonly attempt: number; readonly session: SessionInfo }
  | { readonly type: "fork.failed"; readonly attempt: number; readonly message: string }
  | { readonly type: "fork.timed-out"; readonly attempt: number }
  /** The route moved to another session. */
  | { readonly type: "session.changed" }
  /** The dialog started closing, or the owner was disposed. */
  | { readonly type: "disposed" }

export type SessionForkEffect =
  | {
      readonly type: "fork.start"
      readonly attempt: number
      readonly sessionID: string
      readonly messageID: string
      readonly timeoutMs: number
    }
  /** Ends a run nobody waits for any more: aborts its request and resolves its caller with false. */
  | { readonly type: "fork.cancel"; readonly attempt: number }
  | {
      readonly type: "fork.open"
      readonly attempt: number
      readonly session: SessionInfo
      readonly draft: SessionForkDraft
    }
  | { readonly type: "fork.fail"; readonly attempt: number; readonly message?: string }
  | { readonly type: "dialog.close" }

export type SessionForkTransition = {
  readonly state: SessionForkState
  readonly effects: readonly SessionForkEffect[]
}

export function createSessionForkState(surface: SessionForkSurface): SessionForkState {
  return { status: "idle", surface, attempt: 0 }
}

export function transitionSessionFork(state: SessionForkState, event: SessionForkEvent): SessionForkTransition {
  if (state.status === "closed") return unchanged(state)

  if (event.type === "disposed") {
    return {
      state: { status: "closed", surface: state.surface, attempt: state.attempt },
      effects: cancel(state),
    }
  }

  if (event.type === "session.changed") {
    // The picker lists the previous session's prompts, so it goes with that session.
    if (state.surface === "dialog") {
      return {
        state: { status: "closed", surface: state.surface, attempt: state.attempt },
        effects: [...cancel(state), { type: "dialog.close" }],
      }
    }

    if (state.status === "idle") return unchanged(state)

    return { state: { status: "idle", surface: state.surface, attempt: state.attempt }, effects: cancel(state) }
  }

  if (event.type === "fork.requested") {
    // One fork at a time: a second Enter, click or row waits for the first to settle.
    if (state.status !== "idle") return unchanged(state)
    const attempt = state.attempt + 1

    return {
      state: {
        status: "forking",
        surface: state.surface,
        attempt,
        sessionID: event.sessionID,
        messageID: event.messageID,
        draft: event.draft,
      },
      effects: [
        {
          type: "fork.start",
          attempt,
          sessionID: event.sessionID,
          messageID: event.messageID,
          timeoutMs: FORK_TIMEOUT_MS,
        },
      ],
    }
  }

  if (state.status !== "forking" || event.attempt !== state.attempt) return unchanged(state)

  const idle: SessionForkState = { status: "idle", surface: state.surface, attempt: state.attempt }

  if (event.type === "fork.succeeded") {
    const open: SessionForkEffect = {
      type: "fork.open",
      attempt: state.attempt,
      session: event.session,
      draft: state.draft,
    }

    if (state.surface === "inline") return { state: idle, effects: [open] }

    return {
      state: { status: "closed", surface: state.surface, attempt: state.attempt },
      effects: [open, { type: "dialog.close" }],
    }
  }

  if (event.type === "fork.failed") {
    return { state: idle, effects: [{ type: "fork.fail", attempt: state.attempt, message: event.message }] }
  }

  return {
    state: idle,
    effects: [
      { type: "fork.cancel", attempt: state.attempt },
      { type: "fork.fail", attempt: state.attempt },
    ],
  }
}

export function selectSessionForkView(state: SessionForkState) {
  return {
    disabled: state.status !== "idle",
    pendingMessageID: state.status === "forking" ? state.messageID : undefined,
  }
}

function cancel(state: SessionForkState): SessionForkEffect[] {
  return state.status === "forking" ? [{ type: "fork.cancel", attempt: state.attempt }] : []
}

function unchanged(state: SessionForkState): SessionForkTransition {
  return { state, effects: [] }
}

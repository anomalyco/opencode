import type { SessionInfo } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"

/** Where the import was asked from: the imported session opens only while the user is still there. */
export type ProjectImportTarget = {
  readonly conn: ServerConnection.Any
  readonly worktree: string
  readonly originPath: string
}

/**
 * Importing a session transcript into a project: the file picker is open, or the transcript is uploading. One import at
 * a time. An upload the owner outlives (`disposed`) still lands, and reports, without taking over the window.
 */
export type ProjectImportState =
  | { readonly status: "idle"; readonly attempt: number }
  | { readonly status: "picking"; readonly attempt: number; readonly target: ProjectImportTarget }
  | { readonly status: "importing"; readonly attempt: number; readonly target: ProjectImportTarget }
  | { readonly status: "disposed" }

export type ProjectImportEvent =
  | { readonly type: "import.requested"; readonly target: ProjectImportTarget }
  /** `file`: undefined when the picker was cancelled. */
  | { readonly type: "picker.closed"; readonly attempt: number; readonly file: File | undefined }
  | { readonly type: "picker.failed"; readonly attempt: number; readonly cause: unknown }
  | {
      readonly type: "import.succeeded"
      readonly attempt: number
      readonly target: ProjectImportTarget
      readonly session: SessionInfo
      readonly currentPath: string
    }
  | { readonly type: "import.failed"; readonly attempt: number; readonly cause: unknown }
  | { readonly type: "disposed" }

export type ProjectImportEffect =
  | { readonly type: "picker.open"; readonly attempt: number }
  | { readonly type: "upload.start"; readonly attempt: number; readonly target: ProjectImportTarget; readonly file: File }
  | { readonly type: "toast.pending.show" }
  | { readonly type: "toast.pending.dismiss" }
  | { readonly type: "toast.failed"; readonly cause: unknown }
  | { readonly type: "session.open"; readonly target: ProjectImportTarget; readonly session: SessionInfo }
  /** The imported session joins the lists without switching tabs. */
  | { readonly type: "session.remember"; readonly target: ProjectImportTarget; readonly session: SessionInfo }

export type ProjectImportTransition = {
  readonly state: ProjectImportState
  readonly effects: readonly ProjectImportEffect[]
}

const NO_EFFECTS: readonly never[] = Object.freeze([])

const PENDING_DISMISS: ProjectImportEffect = Object.freeze({ type: "toast.pending.dismiss" })

export const INITIAL_PROJECT_IMPORT_STATE: ProjectImportState = Object.freeze({ status: "idle", attempt: 0 })

const DISPOSED: ProjectImportState = Object.freeze({ status: "disposed" })

export function transitionProjectImport(state: ProjectImportState, event: ProjectImportEvent): ProjectImportTransition {
  if (state.status === "disposed") {
    // Only an upload can outlive its owner, and only one runs at a time.
    if (event.type === "import.succeeded")
      return {
        state,
        effects: [PENDING_DISMISS, { type: "session.remember", target: event.target, session: event.session }],
      }

    if (event.type === "import.failed")
      return { state, effects: [PENDING_DISMISS, { type: "toast.failed", cause: event.cause }] }

    return { state, effects: NO_EFFECTS }
  }

  if (event.type === "disposed") return { state: DISPOSED, effects: NO_EFFECTS }

  if (event.type === "import.requested") {
    // A second Import session while the picker is open or a transcript uploads would run two imports.
    if (state.status !== "idle") return { state, effects: NO_EFFECTS }
    const attempt = state.attempt + 1

    return {
      state: { status: "picking", attempt, target: event.target },
      effects: [{ type: "picker.open", attempt }],
    }
  }

  if (state.status === "idle" || event.attempt !== state.attempt) return { state, effects: NO_EFFECTS }

  const idle: ProjectImportState = { status: "idle", attempt: state.attempt }

  if (state.status === "picking") {
    if (event.type === "picker.failed") return { state: idle, effects: [{ type: "toast.failed", cause: event.cause }] }

    if (event.type !== "picker.closed") return { state, effects: NO_EFFECTS }

    if (!event.file) return { state: idle, effects: NO_EFFECTS }

    return {
      state: { status: "importing", attempt: state.attempt, target: state.target },
      effects: [
        { type: "toast.pending.show" },
        { type: "upload.start", attempt: state.attempt, target: state.target, file: event.file },
      ],
    }
  }

  if (event.type === "import.failed")
    return { state: idle, effects: [PENDING_DISMISS, { type: "toast.failed", cause: event.cause }] }

  if (event.type !== "import.succeeded") return { state, effects: NO_EFFECTS }

  // The user moved on while the transcript uploaded: the import must not pull them away.
  return {
    state: idle,
    effects: [
      PENDING_DISMISS,
      {
        type: event.currentPath === state.target.originPath ? "session.open" : "session.remember",
        target: state.target,
        session: event.session,
      },
    ],
  }
}

export function selectProjectImporting(state: ProjectImportState) {
  return state.status === "picking" || state.status === "importing"
}

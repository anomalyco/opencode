import type { ServerConnection } from "@/runtime/server/registry"
import type { SessionExportData } from "./export"

export type SessionExportTarget = {
  readonly server: ServerConnection.Key
  readonly sessionID: string
}

/**
 * Session exports, keyed by server and session: /export, the session header's menu and Home's rows share one export
 * per session, which holds it from the first page fetch until the save dialog answers.
 */
export type SessionExportState =
  | {
      readonly status: "active"
      readonly issued: number
      readonly exporting: Readonly<Record<string, number>>
    }
  | { readonly status: "disposed" }

export type SessionExportEvent =
  | { readonly type: "export.requested"; readonly target: SessionExportTarget }
  | {
      readonly type: "export.fetched"
      readonly attempt: number
      readonly target: SessionExportTarget
      readonly data: SessionExportData
    }
  | {
      readonly type: "export.saved"
      readonly attempt: number
      readonly target: SessionExportTarget
      readonly filename: string
      readonly saved: boolean
    }
  | {
      readonly type: "export.failed"
      readonly attempt: number
      readonly target: SessionExportTarget
      readonly message?: string
    }
  | { readonly type: "disposed" }

export type SessionExportEffect =
  | { readonly type: "export.fetch"; readonly attempt: number; readonly target: SessionExportTarget }
  | {
      readonly type: "export.save"
      readonly attempt: number
      readonly target: SessionExportTarget
      readonly data: SessionExportData
    }
  | { readonly type: "export.abort"; readonly attempt: number }
  | { readonly type: "toast.exported"; readonly filename: string }
  | { readonly type: "toast.export-failed"; readonly message?: string }

export type SessionExportTransition = {
  readonly state: SessionExportState
  readonly effects: readonly SessionExportEffect[]
}

const NO_EFFECTS: readonly never[] = Object.freeze([])

export function createSessionExportState(): SessionExportState {
  return { status: "active", issued: 0, exporting: {} }
}

export function transitionSessionExport(state: SessionExportState, event: SessionExportEvent): SessionExportTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed") {
    return {
      state: { status: "disposed" },
      effects: Object.values(state.exporting).map((attempt) => ({ type: "export.abort", attempt })),
    }
  }

  const key = sessionExportKey(event.target)

  if (event.type === "export.requested") {
    // Another surface, or a second click, joins the export already running for this session.
    if (state.exporting[key] !== undefined) return { state, effects: NO_EFFECTS }
    const attempt = state.issued + 1

    return {
      state: { status: "active", issued: attempt, exporting: { ...state.exporting, [key]: attempt } },
      effects: [{ type: "export.fetch", attempt, target: event.target }],
    }
  }

  if (state.exporting[key] !== event.attempt) return { state, effects: NO_EFFECTS }

  // The save dialog may stay open a long time; the export still holds the session until it answers.
  if (event.type === "export.fetched")
    return {
      state,
      effects: [{ type: "export.save", attempt: event.attempt, target: event.target, data: event.data }],
    }

  const next: SessionExportState = {
    ...state,
    exporting: Object.fromEntries(Object.entries(state.exporting).filter(([entry]) => entry !== key)),
  }

  if (event.type === "export.failed")
    return { state: next, effects: [{ type: "toast.export-failed", message: event.message }] }

  // A cancelled save dialog is not a failure.
  return { state: next, effects: event.saved ? [{ type: "toast.exported", filename: event.filename }] : NO_EFFECTS }
}

export function selectSessionExporting(state: SessionExportState, target: SessionExportTarget) {
  return state.status === "active" && state.exporting[sessionExportKey(target)] !== undefined
}

function sessionExportKey(target: SessionExportTarget) {
  return `${target.server}\0${target.sessionID}`
}

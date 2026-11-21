// A page's JavaScript dialogs and the commands running against it. A dialog blocks the renderer, so it interrupts
// every running command but a dialog command, and refuses new ones until it is handled. Commands register here before
// their first await, so a dialog or a cancellation that arrives while one still inspects its target interrupts it too.
// Each dialog event moves `revision`, and handling a dialog closes only the revision it answered: a dialog the page
// opens right after stays open. The user (in the pane) and the agent (browser.dialog) answer the same dialog: the
// first to start answering a revision does, and the other finds it closed.
import type { Browser } from "@opencode/plugin-browser/rpc"

export type DialogInfo = { readonly type: string; readonly message: string; readonly defaultValue: string }

export type ModalDialog =
  | { readonly open: false; readonly revision: number }
  | {
      readonly open: true
      readonly revision: number
      readonly url: string
      readonly dialog: DialogInfo
      /** It opened within `REPEAT_DIALOG_MS` of the last one closing, so the user may stop the page's dialogs. */
      readonly repeat?: boolean
      /** Who is answering it; the other one finds it closed. */
      readonly answering?: "user" | "agent"
    }

/** Chrome offers to stop a page's dialogs when one opens this soon after the last closed. */
export const REPEAT_DIALOG_MS = 1_000

/** Dialog types the page's script opens; a `beforeunload` dialog is the pane's "Leave site?" instead. */
const scripted = ["alert", "confirm", "prompt"]

/**
 * Why a command stopped or never started.
 * - `dialog-open`: a dialog was open when it arrived.
 * - `dialog-interrupted`: a dialog opened while it ran.
 * - `cancelled`: its caller aborted it.
 * - `closed`: the page closed.
 */
export type RunStopReason = "dialog-open" | "dialog-interrupted" | "cancelled" | "closed"

export type DialogGateState =
  | {
      readonly status: "active"
      /** The last run id handed out. */
      readonly issued: number
      readonly modal: ModalDialog
      /** Running commands by run id, with their action type. */
      readonly runs: ReadonlyMap<number, Browser.Method>
      /** The user stopped this document's dialogs: each one is dismissed at once until the next document. */
      readonly suppressed?: boolean
      /** When the last scripted dialog closed, for `repeat`. */
      readonly lastClosedAt?: number
    }
  | { readonly status: "disposed" }

export type DialogGateEvent =
  | {
      readonly type: "dialog.opened"
      readonly url: string
      readonly dialogType: string
      readonly message: string
      readonly defaultPrompt: string
      readonly at?: number
    }
  | { readonly type: "dialog.closed"; readonly at?: number }
  /** `Page.handleJavaScriptDialog` answered the dialog of `revision`. */
  | { readonly type: "dialog.handled"; readonly revision: number; readonly at?: number }
  /** The user or the agent starts answering the dialog of `revision`; only the first one does. */
  | { readonly type: "dialog.answering"; readonly revision: number; readonly by: "user" | "agent" }
  /** The answer of `revision` did not reach Chromium; the dialog may be answered again. */
  | { readonly type: "dialog.answer-failed"; readonly revision: number }
  /** The user chose to stop this document's dialogs. */
  | { readonly type: "dialog.suppressed" }
  /** The main frame committed another document, which may show dialogs again. */
  | { readonly type: "document.committed" }
  | { readonly type: "run.started"; readonly actionType: Browser.Method; readonly aborted: boolean }
  | { readonly type: "run.cancelled"; readonly runID: number }
  | { readonly type: "run.finished"; readonly runID: number }
  | { readonly type: "disposed" }

export type DialogGateEffect =
  | { readonly type: "publish" }
  /** Ends the run's wait with `reason`; `abort` also stops its remaining steps. */
  | {
      readonly type: "interrupt-run"
      readonly runID: number
      readonly reason: Exclude<RunStopReason, "dialog-open">
      readonly abort: boolean
    }
  /** Dismisses a dialog of a document whose dialogs the user stopped. */
  | { readonly type: "dismiss" }

/** The answer to `run.started`. */
export type RunReply =
  | { readonly status: "accepted"; readonly runID: number }
  | { readonly status: "refused"; readonly reason: RunStopReason }

export type DialogGateTransition = {
  readonly state: DialogGateState
  readonly effects: readonly DialogGateEffect[]
  /** Set for `run.started`. */
  readonly reply?: RunReply
  /** Set for `dialog.answering`: whether this answer may go to Chromium, or another one came first. */
  readonly answer?: "accepted" | "closed"
}

const PUBLISH: DialogGateEffect = { type: "publish" }

export const createDialogGateState = (): DialogGateState => ({
  status: "active",
  issued: 0,
  modal: { open: false, revision: 0 },
  runs: new Map(),
})

export function transitionDialogGate(state: DialogGateState, event: DialogGateEvent): DialogGateTransition {
  if (state.status === "disposed") {
    if (event.type !== "run.started") return { state, effects: [] }

    return { state, effects: [], reply: { status: "refused", reason: event.aborted ? "cancelled" : "closed" } }
  }

  switch (event.type) {
    case "dialog.opened": {
      // The page already got its answer, or gets it now: nothing waits on it, so no command stops.
      if (state.suppressed && scripted.includes(event.dialogType)) return { state, effects: [{ type: "dismiss" }] }
      // A navigation is left alone: its beforeunload dialog is answered through browser.dialog, and the pending load
      // then proceeds or not. Every other action stops before its next step, so a validation alert on one field stops
      // the rest.
      const interrupted = [...state.runs].filter(([, actionType]) => actionType !== "dialog")

      return {
        state: {
          ...state,
          modal: {
            open: true,
            revision: state.modal.revision + 1,
            url: event.url,
            dialog: { type: event.dialogType, message: event.message, defaultValue: event.defaultPrompt },
            repeat:
              scripted.includes(event.dialogType) &&
              state.lastClosedAt !== undefined &&
              event.at !== undefined &&
              event.at - state.lastClosedAt <= REPEAT_DIALOG_MS,
          },
          runs: interrupted.length
            ? new Map([...state.runs].filter(([, actionType]) => actionType === "dialog"))
            : state.runs,
        },
        effects: [
          ...interrupted.map(
            ([runID, actionType]): DialogGateEffect => ({
              type: "interrupt-run",
              runID,
              reason: "dialog-interrupted",
              abort: actionType !== "navigate",
            }),
          ),
          PUBLISH,
        ],
      }
    }

    case "dialog.closed":
      if (!state.modal.open) return { state, effects: [] }

      return { state: close(state, event.at), effects: [PUBLISH] }
    case "dialog.handled":
      if (!state.modal.open || state.modal.revision !== event.revision) return { state, effects: [] }

      return { state: close(state, event.at), effects: [PUBLISH] }
    case "dialog.answering":
      if (!state.modal.open || state.modal.revision !== event.revision || state.modal.answering)
        return { state, effects: [], answer: "closed" }

      return { state: { ...state, modal: { ...state.modal, answering: event.by } }, effects: [], answer: "accepted" }
    case "dialog.answer-failed":
      if (!state.modal.open || state.modal.revision !== event.revision || !state.modal.answering)
        return { state, effects: [] }

      return { state: { ...state, modal: { ...state.modal, answering: undefined } }, effects: [] }
    case "dialog.suppressed":
      return { state: { ...state, suppressed: true }, effects: [] }
    case "document.committed":
      if (!state.suppressed && state.lastClosedAt === undefined) return { state, effects: [] }

      return { state: { ...state, suppressed: false, lastClosedAt: undefined }, effects: [] }
    case "run.started": {
      if (event.aborted) return { state, effects: [], reply: { status: "refused", reason: "cancelled" } }

      if (state.modal.open && event.actionType !== "dialog")
        return { state, effects: [], reply: { status: "refused", reason: "dialog-open" } }
      const runID = state.issued + 1

      return {
        state: { ...state, issued: runID, runs: new Map([...state.runs, [runID, event.actionType]]) },
        effects: [],
        reply: { status: "accepted", runID },
      }
    }

    case "run.cancelled":
      if (!state.runs.has(event.runID)) return { state, effects: [] }

      return {
        state: { ...state, runs: without(state.runs, event.runID) },
        effects: [{ type: "interrupt-run", runID: event.runID, reason: "cancelled", abort: true }],
      }
    case "run.finished":
      if (!state.runs.has(event.runID)) return { state, effects: [] }

      return { state: { ...state, runs: without(state.runs, event.runID) }, effects: [] }
    case "disposed":
      return {
        state: { status: "disposed" },
        effects: [...state.runs.keys()].map((runID) => ({
          type: "interrupt-run",
          runID,
          reason: "closed",
          abort: true,
        })),
      }
  }
}

/** The open dialog, as `browser.dialog` reports it; null while none is open. */
export function selectDialog(state: DialogGateState) {
  return state.status === "active" && state.modal.open ? state.modal.dialog : null
}

/** The open dialog and its revision, which a handle passes back so it closes only that dialog. */
export function selectOpenDialog(state: DialogGateState) {
  return state.status === "active" && state.modal.open ? state.modal : undefined
}

/** What a dialog command asks permission for: the dialog's page, or the current page while none is open. */
export function selectDialogTarget(state: DialogGateState, generation: number, pageURL: string): Browser.Target {
  const modal = state.status === "active" ? state.modal : undefined

  return {
    resources: [modal?.open ? modal.url : pageURL],
    key: `${generation}:${modal?.revision ?? 0}:${Boolean(modal?.open)}`,
  }
}

/** A scripted dialog the user answers in the pane, with its revision; null while none is open or it is a beforeunload. */
export function selectUserDialog(state: DialogGateState) {
  if (state.status !== "active" || !state.modal.open || !scripted.includes(state.modal.dialog.type)) return null

  return state.modal
}

/** Whether the user stopped this document's dialogs, so a new one is dismissed before anyone sees it. */
export function selectSuppressed(state: DialogGateState) {
  return state.status === "active" && !!state.suppressed
}

function close(state: Extract<DialogGateState, { status: "active" }>, at: number | undefined) {
  const scriptedDialog = state.modal.open && scripted.includes(state.modal.dialog.type)

  return {
    ...state,
    modal: { open: false as const, revision: state.modal.revision + 1 },
    lastClosedAt: scriptedDialog && at !== undefined ? at : state.lastClosedAt,
  }
}

function without(runs: ReadonlyMap<number, Browser.Method>, runID: number) {
  return new Map([...runs].filter(([id]) => id !== runID))
}

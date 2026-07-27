// Approval mode for interactive workflow starts. Mirrors the `workflows.approval`
// config literal: `first-run` (default) asks once per workflow until "Yes, always"
// persists consent; `always` asks on every start regardless of stored consent;
// `never` starts without ever prompting.
export type ApprovalMode = "always" | "first-run" | "never"

// Pure decision used by the prompt's start gate. `alreadyApproved` is whether the
// workflow's name is in the persisted `workflows.approved` list. The default
// (undefined mode) follows `first-run` so an unconfigured install still gates the
// first interactive start of each workflow.
export function approvalDecision(input: { mode: ApprovalMode | undefined; alreadyApproved: boolean }): "ask" | "start" {
  if (input.mode === "never") return "start"
  if (input.mode === "always") return "ask"
  // first-run (and the undefined default): ask until consent is persisted.
  return input.alreadyApproved ? "start" : "ask"
}

// Session-local memory of workflows the user just approved with "Yes, always" in
// THIS process. Persisting to config is async and visibility of the new value
// hinges on a config re-sync; without this, a second `/workflow <name>` in the
// same session could ask again before the sync lands. We OR this set into
// `alreadyApproved`, so a fresh approval is honoured immediately. It is
// intentionally process-scoped (a TUI process is one session) and never trimmed.
const sessionApproved = new Set<string>()

export function rememberSessionApproval(name: string) {
  sessionApproved.add(name)
}

export function isSessionApproved(name: string) {
  return sessionApproved.has(name)
}

// The user's reply to the interactive start approval dialog. `once` starts this
// run only; `always` persists consent (the caller appends the name to
// `workflows.approved`); `cancel` aborts the start.
export type WorkflowApprovalResult = "once" | "always" | "cancel"

// Minimal slice of the dialog stack API the approval flow drives. Kept narrow so
// the stack choreography below can be unit-tested with a fake dialog that records
// replace/clear calls (and re-fires recorded onClose callbacks to model a
// backdrop dismissal).
export interface ApprovalDialogStack {
  replace(element: unknown, onClose?: () => void | boolean, options?: { notifyClose?: boolean }): void
  clear(): void
}

// The choreography behind DialogWorkflowApproval: it owns the single-shot `decide`
// (so the first of cancel/once/always wins and later calls are no-ops) and the
// replace/clear calls that move between the approval dialog and the read-only
// source pager.
//
// Why it lives here as a plain function instead of inline in the component: the
// stack transitions are the subtle part (a stray onClose firing on `replace`
// would resolve the start prematurely), so we make them testable against a fake
// stack without standing up the whole Solid/opentui render tree.
//
// `renderApproval` and `renderSource` are thunks returning the JSX element for
// each screen; the controller decides which onClose / notifyClose each gets.
export function createApprovalStack(input: {
  dialog: ApprovalDialogStack
  resolve: (result: WorkflowApprovalResult) => void
  renderApproval: (controller: ApprovalStackController) => unknown
  renderSource: (controller: ApprovalStackController) => unknown
}): ApprovalStackController {
  let settled = false
  // Single-shot: the first decision wins. Backdrop/Esc dismissal resolves
  // "cancel" so the start is always abort-safe, and any later Yes/No after the
  // promise already settled is silently ignored.
  function decide(result: WorkflowApprovalResult) {
    if (settled) return
    settled = true
    input.resolve(result)
  }

  // Push the approval dialog. Its onClose decides "cancel" so a backdrop/Esc
  // dismissal of the approval screen aborts the start.
  function showApproval() {
    input.dialog.replace(input.renderApproval(controller), () => decide("cancel"))
  }

  // Swap the approval screen for the source pager. notifyClose:false stops the
  // approval item's onClose (= decide("cancel")) from firing during the swap —
  // otherwise merely viewing the script would resolve the promise as "cancel".
  // The pager gets its OWN onClose (= decide("cancel")) so a backdrop/Esc
  // dismissal inside the pager still resolves the promise instead of hanging.
  function showSource() {
    input.dialog.replace(input.renderSource(controller), () => decide("cancel"), { notifyClose: false })
  }

  // Pager → approval (the "Back" action). Same notifyClose:false reasoning on the
  // return path so swapping back does not fire the pager's onClose; the
  // re-rendered approval item again gets its abort-safe onClose.
  function back() {
    input.dialog.replace(input.renderApproval(controller), () => decide("cancel"), { notifyClose: false })
  }

  // A terminal choice (Yes / Yes, always / No): resolve and tear the stack down.
  function commit(result: WorkflowApprovalResult) {
    decide(result)
    input.dialog.clear()
  }

  const controller: ApprovalStackController = { showApproval, showSource, back, commit, decide }
  return controller
}

export interface ApprovalStackController {
  showApproval(): void
  showSource(): void
  back(): void
  commit(result: WorkflowApprovalResult): void
  decide(result: WorkflowApprovalResult): void
}

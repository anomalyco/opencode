// Pure approval-gate logic for an interactive `/workflow <name>` start, ported
// verbatim from the TUI's `dialog-workflow-approval-helpers.ts`. Kept pure +
// dependency-free so it is unit-testable and browser-safe; the web dialog itself
// is wired separately (the TUI's opentui stack choreography does not apply here).

// Approval mode for interactive workflow starts. Mirrors the `workflows.approval`
// config literal: `first-run` (default) asks once per workflow until "Yes, always"
// persists consent; `always` asks on every start regardless of stored consent;
// `never` starts without ever prompting.
export type ApprovalMode = "always" | "first-run" | "never"

// Pure decision used by the start gate. `alreadyApproved` is whether the
// workflow's name is in the persisted `workflows.approved` list (OR the session
// cache). The default (undefined mode) follows `first-run` so an unconfigured
// install still gates the first interactive start of each workflow.
export function approvalDecision(input: { mode: ApprovalMode | undefined; alreadyApproved: boolean }): "ask" | "start" {
  if (input.mode === "never") return "start"
  if (input.mode === "always") return "ask"
  // first-run (and the undefined default): ask until consent is persisted.
  return input.alreadyApproved ? "start" : "ask"
}

// Session-local memory of workflows the user just approved with "Yes, always" in
// THIS browser session. Persisting to config is async and visibility of the new
// value hinges on a config re-sync; without this, a second `/workflow <name>` in
// the same session could ask again before the sync lands. We OR this set into
// `alreadyApproved`, so a fresh approval is honoured immediately. It is
// intentionally process-scoped and never trimmed.
const sessionApproved = new Set<string>()

export function rememberSessionApproval(name: string) {
  sessionApproved.add(name)
}

export function isSessionApproved(name: string) {
  return sessionApproved.has(name)
}

// Test-only seam: reset the session cache between unit tests so one test's
// "Yes, always" does not leak into another. Never called by app code.
export function resetSessionApprovalForTest() {
  sessionApproved.clear()
}

// The user's reply to the interactive start approval dialog. `once` starts this
// run only; `always` persists consent (the caller appends the name to
// `workflows.approved`); `cancel` aborts the start.
export type WorkflowApprovalResult = "once" | "always" | "cancel"

// Resolves whether a name is already approved, given the persisted list and the
// session cache — the exact OR the TUI gate computes inline. Kept here so the
// gate's "already approved?" derivation is unit-testable.
export function isApproved(name: string, approvedList: readonly string[]): boolean {
  return approvedList.includes(name) || isSessionApproved(name)
}

// Computes the next `workflows.approved` list to persist after a "Yes, always"
// reply: appends the name iff it is not already present (so config.update never
// rewrites the array with a duplicate). Returns `undefined` when no write is
// needed (already present), letting the caller skip the config round-trip.
export function nextApprovedList(name: string, approvedList: readonly string[]): string[] | undefined {
  if (approvedList.includes(name)) return undefined
  return [...approvedList, name]
}

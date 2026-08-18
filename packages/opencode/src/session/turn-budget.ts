// W6-3 / W6-5: records why a turn was forced to stop, so a caller that did not
// run the loop itself can report the outcome honestly.
//
// The structural stop (B1) works by sending the final request with the
// max-steps directive and no tools. That is correct for the model but opaque to
// a parent agent: the subagent's last text is whatever the model wrote in
// response to the directive, which is frequently a restatement of the directive
// itself. A parent reading that cannot tell "finished" from "ran out of budget"
// and surfaces the whole task as an unexplained failure.
//
// Keyed by session id and consumed once, mirroring the per-session bookkeeping
// in overflow.ts. Entries are small and bounded by the number of sessions that
// actually exhaust a budget.

export type StopReason = "max_steps" | "turn_tokens" | "turn_seconds"

export type Exhausted = {
  reason: StopReason
  steps: number
  tokens: number
  seconds: number
}

const exhausted = new Map<string, Exhausted>()

export function record(sessionID: string, info: Exhausted) {
  exhausted.set(sessionID, info)
}

// Reads and clears the entry: a turn's outcome is reported once, and a session
// that later completes normally must not inherit the previous verdict.
export function consume(sessionID: string): Exhausted | undefined {
  const found = exhausted.get(sessionID)
  if (found) exhausted.delete(sessionID)
  return found
}

export function clear(sessionID: string) {
  exhausted.delete(sessionID)
}

export * as TurnBudget from "./turn-budget"

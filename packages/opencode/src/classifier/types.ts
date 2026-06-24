/** The three customizable policy slots (after Claude Code "auto mode"). */
export interface ClassifierPolicy {
  /** Prose descriptions of trusted infrastructure. */
  environment: string[]
  /** Exceptions to the block rules. */
  allow: string[]
  /** Block rules. */
  soft_deny: string[]
}

/** One reasoning-blind transcript line: a user message or a bare tool call. */
export type TranscriptEntry =
  | { role: "user"; text: string }
  | { role: "assistant"; tool: string; input: unknown }

/** The action under evaluation: tool name + its projected (security-relevant) input. */
export interface ClassifierAction {
  tool: string
  input: unknown
}

export interface ClassifierInput {
  transcript: TranscriptEntry[]
  action: ClassifierAction
  policy: ClassifierPolicy
}

export interface ClassifierVerdict {
  /** True → block (deny-and-continue). False → allow silently. */
  shouldBlock: boolean
  /** Reason surfaced to the agent on a block. */
  reason?: string
  /**
   * True when the backend could not produce a decision (API/model error,
   * timeout, unparseable). Callers MUST fail closed (fall back to `ask`).
   */
  unavailable?: boolean
  /** Identifier of the model/backend that produced the verdict. */
  model: string
  durationMs?: number
}

/** A backend that evaluates whether a gated tool call should be blocked. */
export interface ClassifierProvider {
  classify(input: ClassifierInput, signal: AbortSignal): Promise<ClassifierVerdict>
}

/**
 * What the permission gate should do with a would-auto-approve call.
 * `allow` → proceed silently. `block` → deny-and-continue (tool error).
 * `ask` → fall back to a human prompt (fail-closed, or escalation backstop).
 */
export type ClassifierDecision =
  | { kind: "allow" }
  | { kind: "block"; reason: string }
  | { kind: "ask"; reason: string }

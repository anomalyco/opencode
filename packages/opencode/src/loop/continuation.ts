// Adaptive continuation prompt for loops.
//
// Every iteration used to re-send the user's prompt verbatim. When the
// previous iteration stalled (announced a plan, made no tool calls) the model
// re-read its own stall and produced an identical one — the loop only ended
// via the no-progress guard, reported as a fault. Telling the model what just
// went wrong breaks the cycle.
//
// Import-free on purpose, same as ./completion and ./similarity — loop.ts
// imports SessionPrompt, so anything prompt.ts might also want must not route
// through loop.ts (see ./similarity.ts for the boot crash that cycle caused).

/** Signals from the previous iteration that drive prompt selection. */
export interface PreviousOutcome {
  toolCalls: number
  outputLength: number
  wasNearIdentical: boolean
}

// Outputs at or below this length with zero tool calls read as "announced a
// plan (or nothing) and stopped" rather than a substantive answer.
const StallOutputLength = 50

/**
 * Selects the continuation prompt for an iteration.
 *
 * The user's own prompt always forms the base so the model never loses the
 * original goal; a directive is prepended only when the previous iteration's
 * shape calls for one.
 */
export function continuationPrompt(base: string, prev: PreviousOutcome | undefined): string {
  if (prev === undefined) return base
  if (prev.toolCalls === 0 && prev.outputLength === 0) {
    return `Your previous response was empty. Please continue the task with tool calls.\n\n${base}`
  }
  if (prev.toolCalls === 0 && prev.outputLength <= StallOutputLength) {
    return `Your previous response described a plan but used no tools. Execute the plan now — start with your first tool call.\n\n${base}`
  }
  if (prev.toolCalls > 0 && prev.wasNearIdentical) {
    return `You appear to be repeating the same actions. Step back, reassess, and take a different approach.\n\n${base}`
  }
  return base
}

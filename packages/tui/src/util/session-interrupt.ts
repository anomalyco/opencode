/**
 * CP-023 §13.3 - the selected-Session interrupt (double-Escape) decision.
 *
 * The whole decision lives here so the production key handler and the K41
 * matrix exercise the same code rather than a restatement of it.
 *
 * `status` is deliberately absent from `InterruptInput`. §13.3 clause 5 makes
 * the command available whenever a Session is selected, "even if that Session's
 * projected status is idle", and §13.5 forbids status/count as authority
 * because both can lag or omit hidden Task work below the selected Session. A
 * status field cannot gate a decision that cannot see one.
 *
 * The five-second window is carried by `armedAt` rather than by the caller's
 * reset timer. A timer can be stale - it is scheduled against one arming and
 * can fire after a later one - so a decision that trusted it would let clause
 * 4's reset cancel a sequence it does not belong to. The caller still schedules
 * a timer, but only to clear the visual hint.
 */

/** Why a qualifying key press did not reach the interrupt sequence. */
export type InterruptBlock = "autocomplete" | "unfocused" | "no_session"

export type InterruptInput = {
  /** The currently selected Session, if any. */
  sessionID: string | undefined
  /** §13.3 clause 1 - autocomplete precedence. */
  autocompleteVisible: boolean
  /** §13.3 clause 1 - focus precedence. A dialog blurs the prompt input, so an open dialog arrives here as `false`. */
  focused: boolean
  /** §13.3 clause 1 - shell precedence. */
  mode: "normal" | "shell"
  /** How many qualifying presses the current sequence has already taken. */
  armed: number
  /** When the current sequence was armed, in the caller's clock. */
  armedAt: number
  /** The caller's clock now. */
  now: number
}

export type InterruptOutcome =
  | { readonly kind: "blocked"; readonly by: InterruptBlock }
  | { readonly kind: "exit_shell" }
  | { readonly kind: "arm"; readonly armed: number; readonly armedAt: number }
  | { readonly kind: "abort"; readonly sessionID: string }

/** §13.3 clause 2 - the window the first qualifying Escape arms. */
export const INTERRUPT_WINDOW_MS = 5000

/**
 * Returns true while `armedAt` is still inside the window. Exactly
 * `INTERRUPT_WINDOW_MS` later the window has elapsed, which keeps the boundary
 * off the reset timer's own firing instant instead of racing it.
 */
export function interruptWindowOpen(armedAt: number, now: number): boolean {
  return now - armedAt < INTERRUPT_WINDOW_MS
}

export function decideInterrupt(input: InterruptInput): InterruptOutcome {
  // Precedence, in the order §13.3 clause 1 preserves from current behaviour.
  if (input.autocompleteVisible) return { kind: "blocked", by: "autocomplete" }
  if (!input.focused) return { kind: "blocked", by: "unfocused" }
  if (input.mode === "shell") return { kind: "exit_shell" }
  if (!input.sessionID) return { kind: "blocked", by: "no_session" }

  const carried = interruptWindowOpen(input.armedAt, input.now) ? input.armed : 0
  const armed = carried + 1
  if (armed >= 2) return { kind: "abort", sessionID: input.sessionID }
  return { kind: "arm", armed, armedAt: input.now }
}

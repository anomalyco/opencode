/**
 * Who owns a Session's busy status while this client's prompts to it are in flight.
 * - `server`: the server's `session.execution.*` events own the status.
 * - `optimistic`: a prompt dispatched to an idle Session marked it running before the server said so, and no prompt
 *   has been admitted since. `latest` is the newest prompt dispatched to the Session; only its failure puts the status
 *   back to idle, so an older prompt that fails cannot hide the turn a newer prompt started.
 */
export type PromptStatusState = { readonly type: "server" } | { readonly type: "optimistic"; readonly latest: string }

export type PromptStatusEvent =
  /** `working` is whether the Session already showed as running when the prompt went out. */
  | { readonly type: "dispatched"; readonly id: string; readonly working: boolean }
  /** The server holds a prompt, so its events report the status from now on. */
  | { readonly type: "admitted" }
  | { readonly type: "failed"; readonly id: string }

export type PromptStatusEffect = { readonly type: "status.set"; readonly status: "running" | "idle" }

export type PromptStatusTransition = {
  readonly state: PromptStatusState
  readonly effects: readonly PromptStatusEffect[]
}

export const SERVER_PROMPT_STATUS: PromptStatusState = Object.freeze({ type: "server" })

const NO_EFFECTS: readonly PromptStatusEffect[] = Object.freeze([])

export function transitionPromptStatus(state: PromptStatusState, event: PromptStatusEvent): PromptStatusTransition {
  if (event.type === "dispatched") {
    if (!event.working)
      return {
        state: { type: "optimistic", latest: event.id },
        effects: [{ type: "status.set", status: "running" }],
      }

    if (state.type === "server") return { state, effects: NO_EFFECTS }

    return { state: { type: "optimistic", latest: event.id }, effects: NO_EFFECTS }
  }

  if (state.type === "server") return { state, effects: NO_EFFECTS }

  if (event.type === "admitted") return { state: SERVER_PROMPT_STATUS, effects: NO_EFFECTS }

  if (event.id !== state.latest) return { state, effects: NO_EFFECTS }

  return { state: SERVER_PROMPT_STATUS, effects: [{ type: "status.set", status: "idle" }] }
}

/**
 * First-launch onboarding as main sees it, for every window at once. The first window to finish claims the run before
 * it creates the default project, so a second window that finishes meanwhile creates nothing and opens no draft. A
 * failed run releases the claim for a retry.
 */
export type MainOnboardingState =
  /** Startup has not decided yet whether this is a first launch. */
  | { readonly status: "unknown" }
  | { readonly status: "pending"; readonly nextAttempt: number }
  | { readonly status: "finishing"; readonly attempt: number }
  | { readonly status: "completed" }

export type MainOnboardingEvent =
  | { readonly type: "initialized"; readonly complete: boolean }
  /** `directory` is the default project to create, or null when the window does not create one. */
  | { readonly type: "finish.requested"; readonly directory: string | null }
  | { readonly type: "finish.succeeded"; readonly attempt: number }
  | { readonly type: "finish.failed"; readonly attempt: number }

export type MainOnboardingCommand =
  | { readonly type: "make-directory"; readonly attempt: number; readonly directory: string }
  /** Records that onboarding completed, so later launches skip it. */
  | { readonly type: "persist-complete" }

export type MainOnboardingTransition = {
  readonly state: MainOnboardingState
  readonly commands: readonly MainOnboardingCommand[]
}

const UNKNOWN: MainOnboardingState = Object.freeze({ status: "unknown" })

const COMPLETED: MainOnboardingState = Object.freeze({ status: "completed" })

export function createMainOnboardingState(): MainOnboardingState {
  return UNKNOWN
}

export function transitionMainOnboarding(
  state: MainOnboardingState,
  event: MainOnboardingEvent,
): MainOnboardingTransition {
  switch (event.type) {
    case "initialized":
      if (state.status !== "unknown") return unchanged(state)

      return { state: event.complete ? COMPLETED : { status: "pending", nextAttempt: 1 }, commands: [] }

    case "finish.requested":
      // Another window already claimed the run, or it completed: this one creates nothing.
      if (state.status !== "pending") return unchanged(state)

      if (event.directory === null) return { state: COMPLETED, commands: [{ type: "persist-complete" }] }

      return {
        state: { status: "finishing", attempt: state.nextAttempt },
        commands: [{ type: "make-directory", attempt: state.nextAttempt, directory: event.directory }],
      }

    case "finish.succeeded":
      if (state.status !== "finishing" || state.attempt !== event.attempt) return unchanged(state)

      return { state: COMPLETED, commands: [{ type: "persist-complete" }] }

    case "finish.failed":
      if (state.status !== "finishing" || state.attempt !== event.attempt) return unchanged(state)

      return { state: { status: "pending", nextAttempt: state.attempt + 1 }, commands: [] }
  }
}

/** Whether a window should still run onboarding; false while another window's run is in flight. */
export const selectOnboardingPending = (state: MainOnboardingState) => state.status === "pending"

function unchanged(state: MainOnboardingState): MainOnboardingTransition {
  return { state, commands: [] }
}

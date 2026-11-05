/**
 * First-launch onboarding in one window: once its tabs are restored it tells main whether to create the default
 * project, adds that project, then opens a draft in it. Startup keeps the splash up for it, but the hydration timeout
 * can show the app first. From then on the run never navigates, and a failure is a toast rather than the error page.
 */
export type OnboardingState =
  | { readonly status: "waiting" }
  | { readonly status: "finishing" }
  | { readonly status: "seeding"; readonly directory: string }
  | { readonly status: "drafting" }
  | { readonly status: "done" }
  | { readonly status: "disposed" }

// `revealed` is whether startup already showed the app when the result arrived; `canOpenDraft` whether the window still
// shows Home with no tabs, as nothing such as a deep link opened one meanwhile.
export type OnboardingEvent<Tab> =
  | { readonly type: "tabs.hydrated"; readonly shouldTrigger: boolean }
  | { readonly type: "finish.succeeded"; readonly directory: string | null }
  | { readonly type: "finish.failed"; readonly error: unknown; readonly revealed: boolean }
  | { readonly type: "seed.succeeded"; readonly revealed: boolean; readonly canOpenDraft: boolean }
  | { readonly type: "seed.failed"; readonly error: unknown; readonly revealed: boolean }
  | { readonly type: "draft.succeeded"; readonly tab: Tab; readonly revealed: boolean }
  | { readonly type: "draft.failed"; readonly error: unknown; readonly revealed: boolean }
  | { readonly type: "disposed" }

export type OnboardingEffect<Tab> =
  | { readonly type: "finish-onboarding"; readonly shouldTrigger: boolean }
  | { readonly type: "seed-project"; readonly directory: string }
  | { readonly type: "open-draft"; readonly directory: string }
  | { readonly type: "select-draft"; readonly tab: Tab }
  /** Startup may hide the splash. */
  | { readonly type: "notify-settled" }
  /** Startup shows the error page. */
  | { readonly type: "fail-startup"; readonly error: unknown }
  | { readonly type: "show-error-toast"; readonly error: unknown }

export type OnboardingTransition<Tab> = {
  readonly state: OnboardingState
  readonly effects: readonly OnboardingEffect<Tab>[]
}

const DONE: OnboardingState = Object.freeze({ status: "done" })

const DISPOSED: OnboardingState = Object.freeze({ status: "disposed" })

export function createOnboardingState(pending: boolean): OnboardingState {
  return pending ? { status: "waiting" } : DONE
}

// The run only moves forward, one step at a time, so each result names the step it ends and is ignored in any other.
export function transitionOnboarding<Tab>(
  state: OnboardingState,
  event: OnboardingEvent<Tab>,
): OnboardingTransition<Tab> {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed") return { state: DISPOSED, effects: [] }

  switch (event.type) {
    case "tabs.hydrated":
      if (state.status !== "waiting") return unchanged(state)

      return {
        state: { status: "finishing" },
        effects: [{ type: "finish-onboarding", shouldTrigger: event.shouldTrigger }],
      }

    case "finish.succeeded":
      if (state.status !== "finishing") return unchanged(state)

      if (!event.directory) return settled()

      return {
        state: { status: "seeding", directory: event.directory },
        effects: [{ type: "seed-project", directory: event.directory }],
      }

    case "seed.succeeded":
      if (state.status !== "seeding") return unchanged(state)

      // Once the app shows, the user may already be somewhere else: the project is added, but no draft opens.
      if (event.revealed || !event.canOpenDraft) return settled()

      return { state: { status: "drafting" }, effects: [{ type: "open-draft", directory: state.directory }] }

    case "draft.succeeded":
      if (state.status !== "drafting") return unchanged(state)

      if (event.revealed) return settled()

      return { state: DONE, effects: [{ type: "select-draft", tab: event.tab }, { type: "notify-settled" }] }

    case "finish.failed":
      return state.status === "finishing" ? failed(event) : unchanged(state)

    case "seed.failed":
      return state.status === "seeding" ? failed(event) : unchanged(state)

    case "draft.failed":
      return state.status === "drafting" ? failed(event) : unchanged(state)
  }
}

/** The step that waits for the window's tabs to be restored before the run starts. */
export const selectOnboardingWaiting = (state: OnboardingState) => state.status === "waiting"

function settled<Tab>(): OnboardingTransition<Tab> {
  return { state: DONE, effects: [{ type: "notify-settled" }] }
}

// Before the app shows, a failure reaches the error page as it did; afterwards it must not replace a working window.
function failed<Tab>(event: { readonly error: unknown; readonly revealed: boolean }): OnboardingTransition<Tab> {
  return {
    state: DONE,
    effects: [
      event.revealed ? { type: "show-error-toast", error: event.error } : { type: "fail-startup", error: event.error },
    ],
  }
}

function unchanged<Tab>(state: OnboardingState): OnboardingTransition<Tab> {
  return { state, effects: [] }
}

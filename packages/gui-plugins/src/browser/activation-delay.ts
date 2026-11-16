// Input protection for prompts a page can cause, as browsers give theirs: a page that opens a prompt under a click or
// a key press the user is already making must not get that press on the prompt's buttons.

/** How long a prompt's guarded controls ignore input after it appears or changes; Chromium uses about 500 ms. */
export const ACTIVATION_DELAY_MS = 500

/**
 * Whether a press may activate a guarded control: it began on the prompt after the prompt last appeared or changed
 * (`pressedAt`, or none when the press began elsewhere or before), and it lands at least `ACTIVATION_DELAY_MS` after
 * that. All times are event timestamps on one clock.
 */
export function activationAllowed(input: { readonly shownAt: number; readonly pressedAt?: number; readonly at: number }) {
  return input.pressedAt !== undefined && input.pressedAt >= input.shownAt && input.at - input.shownAt >= ACTIVATION_DELAY_MS
}

/**
 * Guards the controls inside `root` marked `data-activation-guard`, and the submission of its forms: a click on one, or
 * a submit, that `activationAllowed` refuses is stopped before any handler of the control sees it. Call `changed` when
 * the prompt shows something new in the same place.
 */
export function guardActivation(root: HTMLElement) {
  const state: { shownAt: number; pressedAt?: number } = { shownAt: performance.now() }

  // A key held down since before the prompt repeats on it; only a press that starts on the prompt counts.
  const pressed = (event: PointerEvent | KeyboardEvent) => {
    if (!(event instanceof KeyboardEvent && event.repeat)) state.pressedAt = event.timeStamp
  }

  const activated = (event: Event) => {
    const guarded = event.type === "submit" || (event.target instanceof Element && event.target.closest("[data-activation-guard]"))

    if (!guarded || activationAllowed({ ...state, at: event.timeStamp })) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  root.addEventListener("pointerdown", pressed, true)
  root.addEventListener("keydown", pressed, true)
  root.addEventListener("click", activated, true)
  root.addEventListener("submit", activated, true)

  return {
    changed() {
      state.shownAt = performance.now()
      state.pressedAt = undefined
    },
    dispose() {
      root.removeEventListener("pointerdown", pressed, true)
      root.removeEventListener("keydown", pressed, true)
      root.removeEventListener("click", activated, true)
      root.removeEventListener("submit", activated, true)
    },
  }
}

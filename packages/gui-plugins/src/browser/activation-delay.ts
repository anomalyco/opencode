// Input protection for what a page can make appear under the user's pointer or keys: refusal and pop-up notices,
// permission bars and page dialogs. A page that shows one under a click or key press the user is already making must
// not get that press on its controls, as browsers protect their own prompts.

/** How long a guarded control ignores presses after it appears or changes; Chromium uses about 500 ms. */
export const ACTIVATION_DELAY_MS = 500

/**
 * Whether a press may activate a guarded control: it began (`pressedAt`) on that control at least `ACTIVATION_DELAY_MS`
 * after the control last appeared or changed (`shownAt`), and the activation (`at`) ends that press. A press that began
 * earlier, or elsewhere (no `pressedAt`), never activates it. All times are event timestamps on one clock.
 */
export function activationAllowed(input: {
  readonly shownAt: number
  readonly pressedAt?: number
  readonly at: number
}) {
  return (
    input.pressedAt !== undefined &&
    input.pressedAt >= input.shownAt + ACTIVATION_DELAY_MS &&
    input.at >= input.pressedAt
  )
}

type Press = Pick<Event, "isTrusted" | "timeStamp" | "currentTarget">

/**
 * One guard for the controls of one presentation, such as a notice's token: make a new one when it changes, not on
 * each render. A click activates only when a trusted, unrepeated press began on the same control (`activationAllowed`).
 */
export function actionGuard(shownAt: number) {
  let pressed: { target: EventTarget | null; at: number } | undefined

  return {
    press(event: Press, repeat = false) {
      pressed = event.isTrusted && !repeat ? { target: event.currentTarget, at: event.timeStamp } : undefined
    },
    cancel() {
      pressed = undefined
    },
    accept(event: Press) {
      const press = pressed
      pressed = undefined

      return (
        !!press &&
        event.isTrusted &&
        press.target === event.currentTarget &&
        activationAllowed({ shownAt, pressedAt: press.at, at: event.timeStamp })
      )
    },
  }
}

/**
 * Guards the controls inside `root` marked `data-activation-guard`, and the submission of its forms, with the same
 * rule: a click on one, or a submit, that `activationAllowed` refuses for the press that led to it is stopped before any
 * handler sees it. Call `changed` when the prompt shows something new in the same place.
 */
export function guardActivation(root: HTMLElement) {
  let shownAt = performance.now()
  let pressed: { target: Element; at: number } | undefined

  // A key held down since before the prompt repeats on it; only a fresh, trusted press on the prompt counts.
  const press = (event: PointerEvent | KeyboardEvent) => {
    const repeat = event instanceof KeyboardEvent && event.repeat

    pressed =
      event.isTrusted && !repeat && event.target instanceof Element
        ? { target: event.target, at: event.timeStamp }
        : undefined
  }

  const activated = (event: Event) => {
    const control =
      event.type === "submit"
        ? event.target instanceof Element
          ? event.target
          : null
        : event.target instanceof Element
          ? event.target.closest("[data-activation-guard]")
          : null

    if (!control) return

    // A click needs its press on the same control; a submit, a press on the prompt, such as Enter in its field.
    const same = !!pressed && (event.type === "submit" || pressed.target.closest("[data-activation-guard]") === control)
    const trusted = event.type === "submit" || event.isTrusted

    if (same && trusted && activationAllowed({ shownAt, pressedAt: pressed?.at, at: event.timeStamp })) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  root.addEventListener("pointerdown", press, true)
  root.addEventListener("keydown", press, true)
  root.addEventListener("click", activated, true)
  root.addEventListener("submit", activated, true)

  return {
    changed() {
      shownAt = performance.now()
      pressed = undefined
    },
    dispose() {
      root.removeEventListener("pointerdown", press, true)
      root.removeEventListener("keydown", press, true)
      root.removeEventListener("click", activated, true)
      root.removeEventListener("submit", activated, true)
    },
  }
}

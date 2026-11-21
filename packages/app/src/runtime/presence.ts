import { observeReducedMotion, prefersReducedMotion } from "@opencode/ui/motion"
import { createEffect, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import {
  createPresenceState,
  DISPOSED_PRESENCE_EVENT,
  ELEMENT_CHANGED_EVENT,
  HIDE_INSTANT_EVENT,
  NO_EXIT,
  PRESENCE_DEFAULT_EXIT_MS,
  PRESENCE_EXIT_GRACE_MS,
  REDUCED_PRESENCE_EVENT,
  SHOW_PRESENCE_EVENT,
  TRANSITION_END_EVENT,
  countNewAnimations,
  maxCssTimeMs,
  selectPresencePhase,
  transitionPresence,
  type PresenceEvent,
  type PresenceExit,
} from "./presence-machine"

// Keeps an element mounted while its CSS exit animation or transition runs. A fallback timer from the computed
// duration hides it when no end event comes (a detached element, a hidden ancestor), and Reduce Motion hides it at once.
// `instant` skips the exit, for a change that should not animate.
export function createPresence(props: {
  show: Accessor<boolean>
  element: Accessor<HTMLElement | null>
  instant?: Accessor<boolean>
}) {
  let current = createPresenceState(untrack(props.show))
  const [phase, setPhase] = createSignal(selectPresencePhase(current))
  let tracked: HTMLElement | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const started = { type: "animation.started" as const, name: "", current: "" }
  const ended = { type: "animation.ended" as const, name: "" }

  const dispatch = (event: PresenceEvent) => {
    const previous = current
    const next = transitionPresence(previous, event)

    if (next === previous) return
    current = next

    // A hiding state is only replaced on the way out of hiding; counting down returns the same object.
    if (previous.status === "hiding") {
      clearTimeout(timer)
      timer = undefined
    }

    if (next.status === "hiding") {
      const attempt = next.attempt
      timer = setTimeout(() => dispatch({ type: "timeout", attempt }), next.timeoutMs)
    }

    if (next.status !== "disposed") setPhase(selectPresencePhase(next))
  }

  const onAnimationStart = (event: AnimationEvent) => {
    const element = tracked

    if (!element || event.target !== element || current.status !== "present") return
    started.name = event.animationName
    started.current = getComputedStyle(element).animationName || "none"
    dispatch(started)
  }

  const onAnimationEnd = (event: AnimationEvent) => {
    if (event.target !== tracked) return
    ended.name = event.animationName
    dispatch(ended)
  }

  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target === tracked) dispatch(TRANSITION_END_EVENT)
  }

  const detach = (element: HTMLElement) => {
    element.removeEventListener("animationstart", onAnimationStart)
    element.removeEventListener("animationend", onAnimationEnd)
    element.removeEventListener("animationcancel", onAnimationEnd)
    element.removeEventListener("transitionend", onTransitionEnd)
    element.removeEventListener("transitioncancel", onTransitionEnd)
  }

  createEffect(() => {
    const element = props.element()

    if (element === tracked) return
    const previous = tracked

    if (previous) detach(previous)
    tracked = element
    element?.addEventListener("animationstart", onAnimationStart)
    element?.addEventListener("animationend", onAnimationEnd)
    element?.addEventListener("animationcancel", onAnimationEnd)
    element?.addEventListener("transitionend", onTransitionEnd)
    element?.addEventListener("transitioncancel", onTransitionEnd)

    if (previous) untrack(() => dispatch(ELEMENT_CHANGED_EVENT))
  })

  createEffect(() => {
    const show = props.show()
    const instant = props.instant?.() ?? false

    untrack(() => {
      if (show) return dispatch(SHOW_PRESENCE_EVENT)

      if (instant || prefersReducedMotion()) return dispatch(HIDE_INSTANT_EVENT)

      if (current.status !== "present") return
      dispatch({ type: "hide", exit: measureExit(tracked, current.started) })
    })
  })

  onCleanup(
    observeReducedMotion(() => {
      if (prefersReducedMotion()) dispatch(REDUCED_PRESENCE_EVENT)
    }),
  )

  onCleanup(() => {
    if (tracked) detach(tracked)
    tracked = null
    dispatch(DISPOSED_PRESENCE_EVENT)
  })

  return { present: () => phase() !== "hidden", state: phase }
}

function measureExit(element: HTMLElement | null, started: string): PresenceExit {
  if (!element?.isConnected) return NO_EXIT
  const styles = getComputedStyle(element)

  if (styles.display === "none") return NO_EXIT
  const names = styles.animationName || "none"
  const count = countNewAnimations(names, started)

  if (count > 0)
    return {
      kind: "animation",
      names,
      count,
      timeoutMs: exitTimeout(maxCssTimeMs(styles.animationDuration, styles.animationDelay)),
    }

  const ms = maxCssTimeMs(styles.transitionDuration, styles.transitionDelay)

  if (ms <= 0 || !styles.transitionProperty || styles.transitionProperty === "none") return NO_EXIT

  // Only transitions that are running now hold the element: an idle `transition-colors` rule must not. Without the
  // Web Animations API (happy-dom), trust the computed transition.
  const transitions =
    "getAnimations" in element
      ? element.getAnimations().filter((animation) => "transitionProperty" in animation).length
      : 1

  if (transitions === 0) return NO_EXIT

  return { kind: "transition", count: transitions, timeoutMs: exitTimeout(ms) }
}

function exitTimeout(ms: number) {
  return (ms > 0 ? ms : PRESENCE_DEFAULT_EXIT_MS) + PRESENCE_EXIT_GRACE_MS
}

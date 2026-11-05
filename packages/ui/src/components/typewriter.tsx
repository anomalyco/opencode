import { createEffect, createMemo, createSignal, onCleanup, Show, untrack, type ValidComponent } from "solid-js"
import { Dynamic } from "solid-js/web"
import { observeReducedMotion, prefersReducedMotion } from "../motion/reduced"
import {
  DISPOSED_TYPEWRITER_EVENT,
  INITIAL_EMPTY_TYPEWRITER_STATE,
  selectTypewriterCursor,
  selectTypewriterDisplayed,
  transitionTypewriter,
  TYPEWRITER_INITIAL_DELAY_MS,
  TYPEWRITER_LINGER_MS,
  typingStepDelayMs,
  type TypewriterEvent,
} from "./typewriter-machine"

export const Typewriter = <T extends ValidComponent = "p">(props: { text?: string; class?: string; as?: T }) => {
  const [state, setState] = createSignal(INITIAL_EMPTY_TYPEWRITER_STATE)
  let timer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: TypewriterEvent) => {
    const previous = untrack(state)
    const next = transitionTypewriter(previous, event)

    if (next.effect.type !== "none") {
      clearTimeout(timer)
      timer = undefined
    }

    if (next.state !== previous && next.state.status !== "disposed") setState(next.state)

    if (next.effect.type !== "schedule") return
    const effect = next.effect
    const timeout: TypewriterEvent =
      effect.kind === "linger"
        ? { type: "linger.ended", attempt: effect.attempt }
        : { type: "typing.step", attempt: effect.attempt }

    timer = setTimeout(
      () => {
        timer = undefined
        dispatch(timeout)
      },
      effect.kind === "initial"
        ? TYPEWRITER_INITIAL_DELAY_MS
        : effect.kind === "linger"
          ? TYPEWRITER_LINGER_MS
          : typingStepDelayMs(Math.random(), Math.random()),
    )
  }

  const sync = () => dispatch({ type: "sync", text: props.text, reducedMotion: prefersReducedMotion() })

  createEffect(sync)

  onCleanup(observeReducedMotion(() => untrack(sync)))

  onCleanup(() => dispatch(DISPOSED_TYPEWRITER_EVENT))

  const cursor = createMemo(() => selectTypewriterCursor(state()))

  return (
    <Dynamic component={props.as || "p"} class={props.class}>
      {selectTypewriterDisplayed(state())}
      <Show when={cursor() !== "none"}>
        <span classList={{ "blinking-cursor": cursor() === "blinking" }}>│</span>
      </Show>
    </Dynamic>
  )
}

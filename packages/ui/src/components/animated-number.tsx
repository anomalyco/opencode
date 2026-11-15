import { For, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import { prefersReducedMotion } from "../motion/reduced"
import {
  ANIMATED_NUMBER_FALLBACK_PAD_MS,
  ANIMATED_NUMBER_TRACK_LENGTH,
  createAnimatedDigitState,
  createAnimatedNumberState,
  selectAnimatedDigitRolling,
  selectAnimatedDigitStep,
  selectAnimatedNumberDirection,
  selectAnimatedNumberPlaces,
  selectAnimatedNumberResizing,
  selectAnimatedNumberValue,
  transitionAnimatedDigit,
  transitionAnimatedNumber,
  type AnimatedDigitEvent,
  type AnimatedNumberEffect,
  type AnimatedNumberEvent,
} from "./animated-number-machine"

const TRACK = Array.from({ length: ANIMATED_NUMBER_TRACK_LENGTH }, (_, index) => index % 10)

const DURATION = 600

const ROLL_ENDED: AnimatedDigitEvent = { type: "roll.ended" }

const RESIZE_ENDED: AnimatedNumberEvent = { type: "resize.ended" }

function Digit(props: { value: number; direction: 1 | -1 }) {
  const [digit, setDigit] = createSignal(createAnimatedDigitState(props.value))
  let strip: HTMLSpanElement | undefined

  const fallback = createFallback(
    () => strip,
    (attempt) => dispatch({ type: "roll.timed-out", attempt }),
  )

  const dispatch = (event: AnimatedDigitEvent) => {
    const prev = untrack(digit)
    const next = transitionAnimatedDigit(prev, event)

    if (next.state !== prev) setDigit(next.state)
    next.effects.forEach(fallback)
  }

  createEffect(
    on(
      () => props.value,
      (value) =>
        dispatch({ type: "digit.changed", digit: value, direction: props.direction, canAnimate: canAnimate(strip) }),
      { defer: true },
    ),
  )

  onCleanup(() => dispatch({ type: "disposed" }))

  const ended = (event: TransitionEvent) => {
    if (transitionEnded(event, strip, "top")) dispatch(ROLL_ENDED)
  }

  return (
    <span data-slot="animated-number-digit" data-animating={selectAnimatedDigitRolling(digit()) ? "true" : "false"}>
      <span data-slot="animated-number-static" data-digit={props.value} />
      <span
        ref={strip}
        data-slot="animated-number-strip"
        onTransitionEnd={ended}
        onTransitionCancel={ended}
        style={{
          "--animated-number-offset": `${selectAnimatedDigitStep(digit())}`,
          "--animated-number-duration": `var(--tool-motion-odometer-ms, ${DURATION}ms)`,
        }}
      >
        <For each={TRACK}>{(value) => <span data-slot="animated-number-cell" data-digit={value} />}</For>
      </span>
    </span>
  )
}

export function AnimatedNumber(props: { value: number; class?: string }) {
  const target = createMemo(() => {
    if (!Number.isFinite(props.value)) return 0

    return Math.max(0, Math.round(props.value))
  })

  // A spare leading zero waits outside the clipped width to roll in. A digit that leaves stays until the width has
  // shrunk past it, so it rolls to zero instead of vanishing.
  const [number, setNumber] = createSignal(createAnimatedNumberState(target()))
  let box: HTMLSpanElement | undefined

  const fallback = createFallback(
    () => box,
    (attempt) => dispatch({ type: "resize.timed-out", attempt }),
  )

  const dispatch = (event: AnimatedNumberEvent) => {
    const prev = untrack(number)
    const next = transitionAnimatedNumber(prev, event)

    if (next.state !== prev) setNumber(next.state)
    next.effects.forEach(fallback)
  }

  createEffect(
    on(target, (value) => dispatch({ type: "value.changed", value, canAnimate: canAnimate(box) }), { defer: true }),
  )

  onCleanup(() => dispatch({ type: "disposed" }))

  const value = () => selectAnimatedNumberValue(number())
  const direction = () => selectAnimatedNumberDirection(number())
  const label = createMemo(() => value().toString())
  const count = createMemo(() => selectAnimatedNumberPlaces(number()))

  // Place values, most significant first. Keying by place keeps each digit rolling as digits appear and leave.
  const places = createMemo(() => Array.from({ length: count() }, (_, index) => count() - 1 - index))

  const ended = (event: TransitionEvent) => {
    if (transitionEnded(event, box, "width")) dispatch(RESIZE_ENDED)
  }

  return (
    <span data-component="animated-number" class={props.class}>
      {/* The value is the only text: screen readers and copy read it once, in order. CSS draws the digits. */}
      <span class="sr-only">{label()}</span>
      <span
        ref={box}
        data-slot="animated-number-value"
        data-resizing={selectAnimatedNumberResizing(number()) ? "true" : "false"}
        aria-hidden="true"
        style={{ "--animated-number-width": `${label().length}ch` }}
        onTransitionEnd={ended}
        onTransitionCancel={ended}
      >
        <For each={places()}>
          {(place) => <Digit value={Math.floor(value() / 10 ** place) % 10} direction={direction()} />}
        </For>
      </span>
    </span>
  )
}

// A detached element never runs a transition, and reduced motion runs them in 0 ms, which reports no end.
function canAnimate(element: HTMLElement | undefined) {
  return element?.isConnected === true && !prefersReducedMotion()
}

// A change that retargets a running transition cancels the old one while the new one keeps going; only a transition
// with nothing left running on the property has ended.
function transitionEnded(event: TransitionEvent, element: HTMLElement | undefined, property: string) {
  if (!element || event.target !== element || event.propertyName !== property) return false

  if (event.type !== "transitioncancel") return true

  return !element
    .getAnimations()
    .some(
      (animation) =>
        animation instanceof CSSTransition &&
        animation.transitionProperty === property &&
        animation.playState === "running",
    )
}

/** Settles an eased change whose end event never arrives, a little after its transition should have finished. */
function createFallback(element: () => HTMLElement | undefined, timeout: (attempt: number) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined

  return (effect: AnimatedNumberEffect) => {
    clearTimeout(timer)
    timer = undefined

    if (effect.type === "clear") return
    // The change's transition styles apply when Solid flushes this update, so measure after it.
    queueMicrotask(() => {
      clearTimeout(timer)
      timer = setTimeout(() => timeout(effect.attempt), transitionMs(element()) + ANIMATED_NUMBER_FALLBACK_PAD_MS)
    })
  }
}

function transitionMs(element: HTMLElement | undefined) {
  if (!element?.isConnected) return 0
  const style = getComputedStyle(element)
  const delays = style.transitionDelay.split(",")

  return Math.max(
    0,
    ...style.transitionDuration
      .split(",")
      .map((duration, index) => milliseconds(duration) + milliseconds(delays[index % delays.length])),
  )
}

function milliseconds(value: string) {
  const time = Number.parseFloat(value)

  if (!Number.isFinite(time)) return 0

  return value.trim().endsWith("ms") ? time : time * 1000
}

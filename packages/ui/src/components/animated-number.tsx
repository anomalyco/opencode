import { For, createEffect, createMemo, on } from "solid-js"
import { createStore } from "solid-js/store"

const TRACK = Array.from({ length: 30 }, (_, index) => index % 10)

const DURATION = 600

function normalize(value: number) {
  return ((value % 10) + 10) % 10
}

function spin(from: number, to: number, direction: 1 | -1) {
  if (from === to) return 0

  if (direction > 0) return (to - from + 10) % 10

  return -((from - to + 10) % 10)
}

function Digit(props: { value: number; direction: 1 | -1 }) {
  const [state, setState] = createStore({
    step: props.value + 10,
    animating: false,
  })

  const step = () => state.step
  const animating = () => state.animating
  let last = props.value
  let strip: HTMLSpanElement | undefined

  createEffect(
    on(
      () => props.value,
      (next) => {
        const delta = spin(last, next, props.direction)
        last = next

        // An unchanged digit keeps any roll it is in the middle of.
        if (!delta) return

        const target = step() + delta

        // A detached digit never finishes a roll, and rapid changes can run off the track, so both settle at once.
        if (!strip?.isConnected || target < 0 || target >= TRACK.length) {
          setState({ animating: false, step: next + 10 })

          return
        }

        setState({ animating: true, step: target })
      },
      { defer: true },
    ),
  )

  return (
    <span data-slot="animated-number-digit" data-animating={animating() ? "true" : "false"}>
      <span data-slot="animated-number-static" data-digit={props.value} />
      <span
        ref={strip}
        data-slot="animated-number-strip"
        onTransitionEnd={() => {
          setState("animating", false)
          setState("step", (value) => normalize(value) + 10)
        }}
        style={{
          "--animated-number-offset": `${step()}`,
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
  const [state, setState] = createStore<{ value: number; direction: 1 | -1; places: number; resizing: boolean }>({
    value: target(),
    direction: 1,
    places: String(target()).length + 1,
    resizing: false,
  })

  const value = () => state.value
  const direction = () => state.direction
  let box: HTMLSpanElement | undefined

  createEffect(
    on(
      target,
      (next) => {
        const current = value()

        if (next === current) return

        const digits = String(next).length

        // A detached number cannot ease its width and would never hear it end, so it settles at once.
        if (!box?.isConnected) {
          setState({ direction: next > current ? 1 : -1, value: next, places: digits + 1, resizing: false })

          return
        }

        // Only a change to the digit count eases the width, so a late font swap or zoom never animates it.
        setState({
          direction: next > current ? 1 : -1,
          value: next,
          places: Math.max(state.places, digits + 1),
          resizing: state.resizing || digits !== String(current).length,
        })
      },
      { defer: true },
    ),
  )

  const label = createMemo(() => value().toString())

  // Place values, most significant first. Keying by place keeps each digit rolling as digits appear and leave.
  const places = createMemo(() => Array.from({ length: state.places }, (_, index) => state.places - 1 - index))

  return (
    <span data-component="animated-number" class={props.class}>
      {/* The value is the only text: screen readers and copy read it once, in order. CSS draws the digits. */}
      <span class="sr-only">{label()}</span>
      <span
        ref={box}
        data-slot="animated-number-value"
        data-resizing={state.resizing ? "true" : "false"}
        aria-hidden="true"
        style={{ "--animated-number-width": `${label().length}ch` }}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget) setState({ places: label().length + 1, resizing: false })
        }}
      >
        <For each={places()}>
          {(place) => <Digit value={Math.floor(value() / 10 ** place) % 10} direction={direction()} />}
        </For>
      </span>
    </span>
  )
}

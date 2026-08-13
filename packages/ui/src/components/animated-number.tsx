import { For, Index, createEffect, createMemo, on } from "solid-js"
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

  createEffect(
    on(
      () => props.value,
      (next) => {
        const delta = spin(last, next, props.direction)
        last = next
        if (!delta) {
          setState("animating", false)
          setState("step", next + 10)
          return
        }

        setState("animating", true)
        setState("step", (value) => value + delta)
      },
      { defer: true },
    ),
  )

  return (
    <span data-slot="animated-number-digit">
      <span
        data-slot="animated-number-strip"
        data-animating={animating() ? "true" : "false"}
        onTransitionEnd={() => {
          setState("animating", false)
          setState("step", (value) => normalize(value) + 10)
        }}
        style={{
          "--animated-number-offset": `${step()}`,
          "--animated-number-duration": `var(--tool-motion-odometer-ms, ${DURATION}ms)`,
        }}
      >
        <For each={TRACK}>{(value) => <span data-slot="animated-number-cell">{value}</span>}</For>
      </span>
    </span>
  )
}

export function AnimatedNumber(props: { value: number; class?: string }) {
  const target = createMemo(() => {
    if (!Number.isFinite(props.value)) return 0
    return Math.max(0, Math.round(props.value))
  })

  const [state, setState] = createStore({
    value: target(),
    direction: 1 as 1 | -1,
  })
  const value = () => state.value
  const direction = () => state.direction

  createEffect(
    on(
      target,
      (next) => {
        const current = value()
        if (next === current) return

        setState("direction", next > current ? 1 : -1)
        setState("value", next)
      },
      { defer: true },
    ),
  )

  const label = createMemo(() => value().toString())
  const digits = createMemo(() =>
    Array.from(label(), (char) => {
      const code = char.charCodeAt(0) - 48
      if (code < 0 || code > 9) return 0
      return code
    }).reverse(),
  )
  const width = createMemo(() => `${digits().length}ch`)

  return (
    <span data-component="animated-number" class={props.class} aria-label={label()}>
      <span data-slot="animated-number-value" style={{ "--animated-number-width": width() }}>
        <Index each={digits()}>{(digit) => <Digit value={digit()} direction={direction()} />}</Index>
      </span>
    </span>
  )
}

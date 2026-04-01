import { For, Index, createEffect, createMemo, createSignal, on } from "solid-js"

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
  const [step, setStep] = createSignal(props.value + 10)
  const [animating, setAnimating] = createSignal(false)
  let last = props.value

  createEffect(
    on(
      () => props.value,
      (next) => {
        const delta = spin(last, next, props.direction)
        last = next
        if (!delta) {
          setAnimating(false)
          setStep(next + 10)
          return
        }

        setAnimating(true)
        setStep((value) => value + delta)
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
          setAnimating(false)
          setStep((value) => normalize(value) + 10)
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

  const [value, setValue] = createSignal(target())
  const [direction, setDirection] = createSignal<1 | -1>(1)

  createEffect(
    on(
      target,
      (next) => {
        const current = value()
        if (next === current) return

        setDirection(next > current ? 1 : -1)
        setValue(next)
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

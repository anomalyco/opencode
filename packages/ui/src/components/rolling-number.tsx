import { For, createEffect, createMemo, on, onCleanup } from "solid-js"
import { frameLoop, prefersReducedMotion, Spring, type DurationOptions } from "../motion"

const settle: DurationOptions = { duration: 0.375, bounce: 0 }

// A whole number whose changed digits roll: up when it grows, down when it shrinks. Each digit rolls inside its own
// box on a bounce-free spring, by transform and opacity only, and swaps at once under reduced motion. Digits are
// tabular, so the width holds while they roll.
export function RollingNumber(props: { value: number; spring?: DurationOptions; class?: string }) {
  const shown = createMemo<{ text: string; dir: number }>(
    (last) => {
      const value = Number.isFinite(props.value) ? Math.max(0, Math.round(props.value)) : 0

      return { text: String(value), dir: value < Number(last.text) ? -1 : 1 }
    },
    { text: "", dir: 1 },
  )

  // Place values, most significant first, so each place keeps its digit box as digits appear and leave.
  const places = createMemo(() =>
    Array.from({ length: shown().text.length }, (_, index) => shown().text.length - 1 - index),
  )

  return (
    <span data-component="rolling-number" class={props.class}>
      <For each={places()}>
        {(place) => (
          <Digit
            digit={shown().text[shown().text.length - 1 - place] ?? ""}
            dir={shown().dir}
            spring={props.spring ?? settle}
          />
        )}
      </For>
    </span>
  )
}

function Digit(props: { digit: string; dir: number; spring: DurationOptions }) {
  let incoming: HTMLSpanElement | undefined
  let outgoing: HTMLSpanElement | undefined
  let spring: Spring | undefined
  let stop: VoidFunction | undefined
  // Offsets in digit heights, down positive: the new digit enters from `enter`, the old one leaves from `from` to `to`.
  let enter = 0
  let from = 0
  let to = 0

  const progress = () => (spring ? Math.max(0, Math.min(1, spring.value)) : 1)

  const paint = () => {
    const p = progress()
    roll(incoming, enter * (1 - p))
    roll(outgoing, from + (to - from) * p)

    if (!spring && outgoing) outgoing.dataset.leaving = ""
  }

  const tick = (dt: number) => {
    spring?.step(dt)

    if (spring?.resting) spring = undefined
    paint()

    if (spring) return true
    stop = undefined

    return false
  }

  let last = props.digit

  createEffect(
    on(
      () => props.digit,
      (next) => {
        const prev = last
        last = next

        if (!incoming || !outgoing || next === prev) return

        if (prefersReducedMotion() || !incoming.isConnected) {
          incoming.textContent = next
          spring = undefined
          paint()

          return
        }

        // A change mid-roll carries on from where both digits are, so together they never show less than one digit.
        // Going back to the digit still leaving brings it back from where it is, and the arriving one leaves the way it
        // came. Otherwise the digit nearer the middle leaves from there, and the new one comes in as far out as the
        // other was, so a digit that had barely appeared never crosses the middle.
        const p = progress()
        const now = { in: enter * (1 - p), out: from + (to - from) * p }
        const back = !!spring && next === outgoing.dataset.leaving
        const near = back || Math.abs(now.in) <= Math.abs(now.out)
        const far = !spring ? 1 : Math.min(1, Math.abs(near ? now.out : now.in))

        if (near) outgoing.dataset.leaving = prev
        from = near ? now.in : now.out
        to = -props.dir
        enter = back ? now.out : props.dir * far
        incoming.textContent = next
        spring = Spring.fromDuration(0, props.spring).set(1)
        paint()
        stop ??= frameLoop.add(tick)
      },
      { defer: true },
    ),
  )

  onCleanup(() => stop?.())

  return (
    <span data-slot="rolling-number-digit">
      <span
        data-slot="rolling-number-glyph"
        ref={(el) => {
          incoming = el
          el.textContent = props.digit
        }}
      />
      {/* The leaving digit is drawn from its attribute, so the number's text is only ever the value it shows. */}
      <span data-slot="rolling-number-glyph" data-leaving="" aria-hidden="true" ref={(el) => (outgoing = el)} />
    </span>
  )
}

function roll(el: HTMLElement | undefined, offset: number) {
  if (!el) return
  const still = Math.abs(offset) < 0.001
  el.style.transform = still ? "" : `translate3d(0,${(offset * 100).toFixed(2)}%,0)`
  el.style.opacity = still ? "" : (1 - Math.min(1, Math.abs(offset))).toFixed(4)
}

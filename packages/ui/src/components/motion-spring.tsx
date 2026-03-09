import { attachSpring, motionValue } from "motion"
import type { SpringOptions } from "motion"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { useReducedMotion } from "../hooks/use-reduced-motion"

type Opt = Pick<SpringOptions, "visualDuration" | "bounce" | "stiffness" | "damping" | "mass" | "velocity">
const eq = (a: Opt | undefined, b: Opt | undefined) =>
  a?.visualDuration === b?.visualDuration &&
  a?.bounce === b?.bounce &&
  a?.stiffness === b?.stiffness &&
  a?.damping === b?.damping &&
  a?.mass === b?.mass &&
  a?.velocity === b?.velocity

export function useSpring(target: () => number, options?: Opt | (() => Opt)) {
  const read = () => (typeof options === "function" ? options() : options)
  const reduce = useReducedMotion()
  const [value, setValue] = createSignal(target())
  const source = motionValue(value())
  const spring = motionValue(value())
  let config = read()
  let reduced = reduce()
  let stop = reduced ? () => {} : attachSpring(spring, source, config)
  let off = spring.on("change", (next) => setValue(next))

  createEffect(() => {
    const next = target()
    if (reduced) {
      source.set(next)
      spring.set(next)
      setValue(next)
      return
    }
    source.set(next)
  })

  createEffect(() => {
    const next = read()
    const skip = reduce()
    if (eq(config, next) && reduced === skip) return
    config = next
    reduced = skip
    stop()
    stop = skip ? () => {} : attachSpring(spring, source, next)
    if (skip) {
      const value = target()
      source.set(value)
      spring.set(value)
      setValue(value)
      return
    }
    setValue(spring.get())
  })

  onCleanup(() => {
    off()
    stop()
    spring.destroy()
    source.destroy()
  })

  return value
}

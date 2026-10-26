import { choice, easing, knob, spring, toggle } from "knobs"
import type { DurationOptions } from "./motion"
import { motionTuning, type Bezier, type MotionKnob } from "./motion-tuning"

/** The knobs field that edits a motion knob, defaulting to its shipped value. */
export function motionField(item: MotionKnob, meta: { label: string; group?: string; subsection?: string }) {
  if (item.kind === "spring") return spring(item.initial, meta)

  if (item.kind === "toggle" || item.kind === "mode") return toggle(item.initial, meta)

  if (item.kind === "easing") return easing(item.initial, meta)

  if (item.kind === "choice") return choice(item.initial, item.options, { ...meta, labels: item.labels })

  return knob(item.initial, { ...meta, min: item.min, max: item.max, step: item.step, unit: item.unit })
}

/** Applies a value from a knob's field (see `motionField`) to the knob. */
export function applyMotion(item: MotionKnob, value: MotionKnob["value"]) {
  if (item.kind === "spring") {
    // SAFETY: a spring knob's field is a spring field.
    return motionTuning.set(item, value as DurationOptions)
  }

  if (item.kind === "easing") {
    // SAFETY: an easing knob's field is an easing field.
    return motionTuning.set(item, [...(value as Bezier)] as Bezier)
  }

  if (item.kind === "toggle" || item.kind === "mode") {
    // SAFETY: a toggle knob's field is a toggle field.
    return motionTuning.set(item, value as boolean)
  }

  if (item.kind === "choice") {
    // SAFETY: a choice knob's field is a choice field.
    return motionTuning.set(item, value as string)
  }

  // SAFETY: a number knob's field is a number field.
  motionTuning.set(item, value as number)
}

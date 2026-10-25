import type { DurationOptions } from "./motion"
import { motionTuning, type MotionAction, type MotionKnob } from "./motion-tuning"

type Mode = Extract<MotionKnob, { kind: "mode" }>

type Toggle = Extract<MotionKnob, { kind: "toggle" }>

/** One feature of the app the Knobs panel tunes: an area's subsection, or the area's own knobs. */
export type MotionFeature = {
  key: string
  area: string
  name: string
  description?: string
  /** A CSS selector for the part of the app the feature changes. */
  target?: string
  /** Every knob in registration order, modes and the switch included. */
  knobs: MotionKnob[]
  /** Alternatives offered beside the spring presets, such as James. */
  modes: Mode[]
  /** The experiment switch that turns the whole feature on or off. */
  switch?: Toggle
  /** What replays its motion. */
  actions: MotionAction[]
}

/** A feature's preset: "shipped", a spring preset, or the id of one of its modes. */
export type MotionFeaturePreset = string

// The areas in the order the panel shows them; any other area follows in the order it registered.
const areas = ["Timeline", "Composer", "Projects", "Voice"]

// Features named here lead their area in this order, whichever module registered first; the rest follow in the order
// they registered.
const order = ["Docks"]

/** Every registered knob and action as features under their areas, leaving out the speed the debug bar owns. */
export function motionFeatures() {
  const knobs = motionTuning.list().filter((item) => item.group !== "Global")
  const actions = motionTuning.actions()
  const rank = (list: string[], name: string) => (list.includes(name) ? list.indexOf(name) : list.length)
  const keys = [...new Set([...knobs, ...actions].map(keyOf))]

  const features = keys.map((key): MotionFeature => {
    const own = knobs.filter((item) => keyOf(item) === key)
    const first = own[0] ?? actions.find((item) => keyOf(item) === key)
    const subsection = first?.subsection

    return {
      key,
      area: first?.group ?? key,
      // An area's own knobs would repeat the area's name, so a lone knob names its feature, else "General".
      name: subsection ?? (own.length === 1 && own[0] ? own[0].label : "General"),
      description: own.find((item) => item.description)?.description,
      target: own.find((item) => item.target)?.target,
      knobs: own,
      modes: own.filter((item): item is Mode => item.kind === "mode"),
      switch: own.find((item): item is Toggle => item.kind === "toggle" && !!item.experiment && !item.when),
      actions: actions.filter((item) => keyOf(item) === key),
    }
  })

  return [...new Set(features.map((feature) => feature.area))]
    .toSorted((a, b) => rank(areas, a) - rank(areas, b))
    .map((area) => ({
      area,
      features: features
        .filter((feature) => feature.area === area)
        .toSorted((a, b) => rank(order, a.name) - rank(order, b.name)),
    }))
}

/** The knobs a feature's page shows as rows: what its `when` allows, without modes or the switch. */
export function featureControls(feature: MotionFeature) {
  return feature.knobs.filter((item) => item.kind !== "mode" && item !== feature.switch && (item.when?.() ?? true))
}

/** Whether anything in the feature differs from what ships. */
export function featureChanged(feature: MotionFeature) {
  return feature.knobs.some(changed)
}

export function changed(item: MotionKnob) {
  if (item.kind === "spring") return !sameSpring(item.value, item.initial)

  if (item.kind === "easing") return item.value.some((value, index) => value !== item.initial[index])

  return item.value !== item.initial
}

/** The presets a feature offers: Shipped and the three spring presets while it shows a spring, then its modes. */
export function featurePresets(feature: MotionFeature): MotionFeaturePreset[] {
  const springs = featureControls(feature).some((item) => item.kind === "spring")

  if (!springs && feature.modes.length === 0) return []

  return ["shipped", "snappy", "smooth", "calm", ...feature.modes.map((item) => item.id)]
}

/**
 * The preset the feature's values match, or undefined when they've been tuned by hand. Experiment choices are the
 * design under test, not tuning, so they never make a feature Custom.
 */
export function activeFeaturePreset(feature: MotionFeature): MotionFeaturePreset | undefined {
  const mode = feature.modes.find((item) => item.value)

  if (mode) return mode.id

  const tuning = feature.knobs.filter((item) => !item.experiment && item.kind !== "mode")

  if (!tuning.some(changed)) return "shipped"

  // A spring preset sets only springs, so any other knob tuned by hand makes the feature Custom.
  if (tuning.some((item) => item.kind !== "spring" && changed(item))) return

  const springs = featureControls(feature).flatMap((item) => (item.kind === "spring" ? [item] : []))

  return (["snappy", "smooth", "calm"] as const).find(
    (preset) => springs.length > 0 && springs.every((item) => sameSpring(item.value, item.presets[preset])),
  )
}

/** Applies a preset: Shipped resets the tuning, a spring preset sets every spring it shows, a mode turns that mode on. */
export function applyFeaturePreset(feature: MotionFeature, preset: MotionFeaturePreset) {
  feature.modes.forEach((item) => {
    if (item.value !== (item.id === preset)) motionTuning.set(item, item.id === preset)
  })

  if (preset === "shipped")
    return feature.knobs.forEach((item) => {
      if (!item.experiment && item.kind !== "mode") reset(item)
    })

  if (preset !== "snappy" && preset !== "smooth" && preset !== "calm") return

  featureControls(feature).forEach((item) => {
    if (item.kind === "spring") motionTuning.set(item, { ...item.presets[preset] })
  })
}

/** Puts every knob in the feature back to what ships, experiments and modes included. */
export function resetFeature(feature: MotionFeature) {
  feature.knobs.forEach(reset)
}

export function reset(item: MotionKnob) {
  if (!changed(item)) return

  if (item.kind === "spring") return motionTuning.set(item, { ...item.initial })

  if (item.kind === "easing") return motionTuning.set(item, [...item.initial])

  motionTuning.set(item, item.initial)
}

function keyOf(item: MotionKnob | MotionAction) {
  return item.subsection ? `${item.group} · ${item.subsection}` : item.group
}

function sameSpring(a: DurationOptions, b: DurationOptions) {
  return a.duration === b.duration && a.bounce === b.bounce
}

import type { DurationOptions } from "./motion"

// Live motion settings for developer mode. Each surface registers knobs under its own group with their shipped defaults,
// plus actions that replay its motion; the Motion workspace (`motion-tuning-panel`) shows a section per group. Choices
// in the "Experiments" group are design variants to try before one ships. Edits persist on this device.

type Knob<Kind extends string, Value> = {
  kind: Kind
  id: string
  /** What the row changes, without the card's name: "Style", "Glide speed". */
  label: string
  group: string
  /**
   * The card it sits on within the group's tab, named for what you see ("Activity chip"): one per experiment or
   * feature. Its first knob's `order` places the card; Experiments' cards follow the window, sidebar first.
   */
  card?: string
  order?: number
  /** One plain line saying what the card changes and where to see it: the card's `groupDescriptions` entry. */
  description?: string
  /** A CSS selector for the part of the app the card changes, outlined while one of its rows is hovered or focused. */
  target?: string
  /** Shown only while this holds, e.g. the controls of the option a choice selects. */
  when?: () => boolean
  initial: Value
  value: Value
}

/** The presets every spring offers, all without bounce. A spring ships Snappy unless it names another. */
export const motionPresets = { snappy: "Snappy", smooth: "Smooth", calm: "Calm" } as const

export type MotionPreset = keyof typeof motionPresets

/** A CSS `cubic-bezier(x1, y1, x2, y2)`. */
export type Bezier = [number, number, number, number]

export type MotionKnob =
  | (Knob<"spring", DurationOptions> & { presets: Record<MotionPreset, DurationOptions> })
  | Knob<"easing", Bezier>
  | Knob<"mode", boolean>
  | Knob<"toggle", boolean>
  | (Knob<"number", number> & { min: number; max: number; step: number; unit?: string })
  | (Knob<"choice", string> & { options: readonly [string, ...string[]]; labels: Record<string, string> })

export type MotionAction = { id: string; label: string; group: string; run: () => void }

type Meta = {
  label: string
  group: string
  card?: string
  order?: number
  description?: string
  target?: string
  when?: () => boolean
}

// Bumped when knobs are merged or renamed, so values saved for the old ones are dropped.
const key = "opencode.motion.v2"

const knobs = new Map<string, MotionKnob>()

const actions = new Map<string, MotionAction>()

const listeners = new Set<() => void>()

// Saved as numbers only: `<id>.duration` and `<id>.bounce` for springs, `<id>.0`…`<id>.3` for easings, 0 or 1 for toggles, the option's index for choices.
const saved = load()

export const motionTuning = {
  /** The spring to run now: its tuned duration scaled by the global speed and slow motion. */
  spring(id: string, meta: Meta & { presets: Record<MotionPreset, DurationOptions>; shipped?: MotionPreset }) {
    const initial = meta.presets[meta.shipped ?? "snappy"]

    const knob = register({
      kind: "spring",
      id,
      label: meta.label,
      group: meta.group,
      card: meta.card,
      order: meta.order,
      when: meta.when,
      description: meta.description,
      target: meta.target,
      initial,
      value: { duration: number(`${id}.duration`, initial.duration), bounce: number(`${id}.bounce`, initial.bounce) },
      presets: meta.presets,
    })

    return (): DurationOptions => ({
      duration: Math.max(0.03, knob.value.duration * timeScale()),
      bounce: Math.min(0.95, Math.max(0, knob.value.bounce)),
    })
  },
  /** A cubic-bezier curve, edited with its handles. */
  easing(id: string, meta: Meta & { value: Bezier }) {
    const knob = register({
      kind: "easing",
      id,
      label: meta.label,
      group: meta.group,
      card: meta.card,
      order: meta.order,
      when: meta.when,
      description: meta.description,
      target: meta.target,
      initial: meta.value,
      // SAFETY: mapping the four indices of a Bezier yields four numbers.
      value: [0, 1, 2, 3].map((index) => number(`${id}.${index}`, meta.value[index])) as Bezier,
    })

    return () => knob.value
  },
  /**
   * An alternative to a section's springs, offered beside the Snappy, Smooth and Calm presets rather than as a row.
   * Choosing it turns it on; choosing any other preset turns it off. Knobs can show only in one or the other with `when`.
   */
  mode(id: string, meta: Meta & { value?: boolean }) {
    const initial = meta.value ?? false

    const knob = register({
      kind: "mode",
      id,
      label: meta.label,
      group: meta.group,
      card: meta.card,
      order: meta.order,
      when: meta.when,
      description: meta.description,
      target: meta.target,
      initial,
      value: number(id, initial ? 1 : 0) === 1,
    })

    return () => knob.value
  },
  toggle(id: string, meta: Meta & { value: boolean }) {
    const knob = register({
      kind: "toggle",
      id,
      label: meta.label,
      group: meta.group,
      card: meta.card,
      order: meta.order,
      when: meta.when,
      description: meta.description,
      target: meta.target,
      initial: meta.value,
      value: number(id, meta.value ? 1 : 0) === 1,
    })

    return () => knob.value
  },
  /** One of several named variants, such as a design experiment. `labels` maps each option to what the panel shows. */
  choice<const T extends string>(id: string, meta: Meta & { value: NoInfer<T>; labels: Record<T, string> }) {
    // SAFETY: a labels record always has at least the initial value's key.
    const options = Object.keys(meta.labels) as [T, ...T[]]

    const knob = register({
      kind: "choice",
      id,
      label: meta.label,
      group: meta.group,
      card: meta.card,
      order: meta.order,
      when: meta.when,
      description: meta.description,
      target: meta.target,
      initial: meta.value,
      value: options[number(id, options.indexOf(meta.value))] ?? meta.value,
      options,
      labels: meta.labels,
    })

    // SAFETY: the panel only sets one of the knob's options.
    return () => knob.value as T
  },
  /**
   * A tuned number. A `time` of "duration" is seconds, stretched by the global speed and slow motion; "rate" is per
   * second, so it shrinks by the same factor.
   */
  number(
    id: string,
    meta: Meta & { value: number; min: number; max: number; step: number; unit?: string; time?: "duration" | "rate" },
  ) {
    const knob = register({
      kind: "number",
      id,
      label: meta.label,
      group: meta.group,
      card: meta.card,
      order: meta.order,
      when: meta.when,
      description: meta.description,
      target: meta.target,
      initial: meta.value,
      value: number(id, meta.value),
      min: meta.min,
      max: meta.max,
      step: meta.step,
      unit: meta.unit,
    })

    return () => {
      if (meta.time === "duration") return knob.value * timeScale()

      if (meta.time === "rate") return knob.value / timeScale()

      return knob.value
    }
  },
  /** A button that replays the motion it names. Returns its removal, for actions bound to a mounted surface. */
  action(action: MotionAction) {
    actions.set(action.id, action)
    notify()

    return () => {
      if (actions.get(action.id) !== action) return
      actions.delete(action.id)
      notify()
    }
  },
  list: () => [...knobs.values()],
  actions: () => [...actions.values()],
  /** Applies an edit and saves every knob that differs from its default. */
  set<K extends MotionKnob>(knob: K, value: K["value"]) {
    knob.value = value
    save()
    notify()
  },
  subscribe(listener: () => void) {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  },
}

const speed = register({
  kind: "number",
  id: "speed",
  label: "Speed",
  group: "Global",
  initial: 1,
  value: number("speed", 1),
  min: 0.25,
  max: 4,
  step: 0.05,
  unit: "×",
})

const slow = register({
  kind: "toggle",
  id: "slow",
  label: "Slow motion (0.25×)",
  group: "Global",
  initial: false,
  value: number("slow", 0) === 1,
})

export const motionGlobals = { speed, slow }

// How many times longer motion takes than tuned.
function timeScale() {
  return (slow.value ? 4 : 1) / speed.value
}

function register<K extends MotionKnob>(knob: K) {
  knobs.set(knob.id, knob)
  notify()

  return knob
}

function notify() {
  listeners.forEach((listener) => listener())
}

function number(id: string, fallback: number) {
  const value = Number(saved[id])

  return id in saved && Number.isFinite(value) ? value : fallback
}

function load(): Record<string, number> {
  try {
    localStorage.removeItem("opencode.motion.v1")

    return JSON.parse(localStorage.getItem(key) ?? "{}")
  } catch {
    return {}
  }
}

function save() {
  const entries = [...knobs.values()]
    .flatMap((knob): [string, number, number][] => {
      if (knob.kind === "spring")
        return [
          [`${knob.id}.duration`, knob.value.duration, knob.initial.duration],
          [`${knob.id}.bounce`, knob.value.bounce, knob.initial.bounce],
        ]

      if (knob.kind === "easing")
        return knob.value.map((value, index): [string, number, number] => [
          `${knob.id}.${index}`,
          value,
          knob.initial[index],
        ])

      if (knob.kind === "toggle" || knob.kind === "mode") return [[knob.id, Number(knob.value), Number(knob.initial)]]

      if (knob.kind === "choice")
        return [[knob.id, knob.options.indexOf(knob.value), knob.options.indexOf(knob.initial)]]

      return [[knob.id, knob.value, knob.initial]]
    })
    .flatMap(([id, value, initial]) => (value === initial ? [] : [[id, value]]))

  try {
    if (entries.length === 0) return localStorage.removeItem(key)
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)))
  } catch {}
}

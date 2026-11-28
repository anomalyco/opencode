import { motionGlobals, motionPresets, motionTuning, type MotionKnob } from "@opencode/ui/motion-tuning"
import { applyMotion, motionField } from "@opencode/ui/motion-tuning-fields"
import { action, type Field, type Values } from "knobs"

/**
 * The Knobs a story names in `parameters.motion` (ids, areas or sub-headings) and their replay buttons. Speed and slow motion
 * come along when there is motion to time.
 */
export function storyMotion(names: readonly string[]) {
  const named = (item: { id: string; group: string; subsection?: string }) =>
    [item.id, item.group, item.subsection].some((key) => key !== undefined && names.includes(key))

  const knobs = motionTuning.list().filter((item) => item.kind !== "mode" && named(item) && (item.when?.() ?? true))
  const actions = motionTuning.actions().filter(named)
  const timed = actions.length > 0 || knobs.some((item) => item.kind === "spring" || item.kind === "easing")

  return { knobs, actions, globals: timed ? [motionGlobals.speed, motionGlobals.slow] : [] }
}

export type StoryMotion = ReturnType<typeof storyMotion>

/**
 * Whether the inspector built from `a` still fits `b`. Compared by instance: a remounted story registers its replay
 * buttons again under the same ids, with callbacks bound to the new mount.
 */
export function sameMotion(a: StoryMotion, b: StoryMotion) {
  const left = [...a.knobs, ...a.actions, ...a.globals]
  const right = [...b.knobs, ...b.actions, ...b.globals]

  return left.length === right.length && left.every((item, index) => item === right[index])
}

/** One card per sub-heading (or area): its knobs and its replay buttons, then speed and slow motion. */
export function motionFields(motion: StoryMotion): { [key: string]: Field } {
  return Object.fromEntries([
    ...motion.knobs.map((item) => [key(item), motionField(item, { label: item.label, group: group(item) })]),
    ...motion.actions.map((item) => [
      `replay.${item.id}`,
      action(item.label, { group: item.subsection ?? item.group, subsection: "Replay", run: item.run }),
    ]),
    ...motion.globals.map((item) => [key(item), motionField(item, { label: item.label, group: item.group })]),
  ])
}

/**
 * The motion cards' place among the story's presets: the states leave every card alone, and each card with springs
 * gets its own strip of Shipped, Snappy, Smooth and Calm.
 */
export function motionScopes(motion: StoryMotion) {
  const springs = motion.knobs.flatMap((item) => (item.kind === "spring" ? [item] : []))
  const scopes = [...new Set(springs.map(group))]
  const groups = [
    ...motion.knobs.map(group),
    ...motion.actions.map((item) => item.subsection ?? item.group),
    ...motion.globals.map(group),
  ]

  return {
    inPresets: Object.fromEntries(groups.map((name) => [name, false])),
    scopedPresets: Object.fromEntries(
      scopes.map((scope) => [
        scope,
        Object.fromEntries(
          presets.map((preset) => [
            motionPresets[preset],
            Object.fromEntries(
              springs.flatMap((item) => (group(item) === scope ? [[key(item), item.presets[preset]]] : [])),
            ),
          ]),
        ),
      ]),
    ),
    defaultLabels: Object.fromEntries(scopes.map((scope) => [scope, "Shipped"])),
  }
}

export function motionValues(motion: StoryMotion) {
  return Object.fromEntries([...motion.knobs, ...motion.globals].map((item) => [key(item), item.value]))
}

/** Applies the motion keys of a change from the inspector. */
export function applyMotionPatch(motion: StoryMotion, patch: Partial<Values<{ [key: string]: Field }>>) {
  ;[...motion.knobs, ...motion.globals].forEach((item) => {
    // SAFETY: each key's field was made from its knob by `motionField`, so its value is that knob's kind.
    const value = patch[key(item)] as MotionKnob["value"] | undefined

    if (value !== undefined) applyMotion(item, value)
  })
}

const presets = ["snappy", "smooth", "calm"] as const

// Apart from the story's own args.
function key(item: MotionKnob) {
  return `motion.${item.id}`
}

function group(item: MotionKnob) {
  return item.subsection ?? item.group
}

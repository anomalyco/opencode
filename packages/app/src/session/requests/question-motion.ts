import { createSignal } from "solid-js"
import { observeReducedMotion, prefersReducedMotion } from "@opencode/ui/motion"
import { motionTuning } from "@opencode/ui/motion-tuning"

// The question dock's motion (the switch between questions, the rolling count, the sliding progress bar, the footer
// buttons, and the dock opening, closing and folding) is off unless this knob is on. Off, every change lands on the
// frame it happens, and none of the animated code runs.
const toggle = motionTuning.toggle("question.motion", {
  label: "Question dock motion",
  group: "Timeline",
  subsection: "Question",
  description: "Moving between questions, and the dock opening, closing and folding",
  target: '[data-component="dock-prompt"][data-kind="question"]',
  value: false,
})

const read = () => toggle() && !prefersReducedMotion()

const [motion, setMotion] = createSignal(read())

motionTuning.subscribe(() => setMotion(read()))

observeReducedMotion(() => setMotion(read()))

/** Whether the question dock animates: only with its knob on, and never under reduced motion. Reactive. */
export const questionMotion = () => motion()

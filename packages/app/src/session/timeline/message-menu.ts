import { motionTuning } from "@opencode/ui/motion-tuning"
import { createSignal } from "solid-js"

const toggle = motionTuning.toggle("session.messageMenu", {
  label: "Enabled",
  group: "Experiments",
  card: "Message menu",
  order: 50,
  description: "A ⋯ menu beside each message in the timeline, instead of the hover info line.",
  target: '[data-slot="message-options"]',
  value: false,
})

const [enabled, setEnabled] = createSignal(toggle())

motionTuning.subscribe(() => setEnabled(toggle()))

/** Experiment: a ⋯ menu per message in a 28px trailing gutter replaces the hover info line, and turns sit 24px apart. */
export const messageMenu = enabled

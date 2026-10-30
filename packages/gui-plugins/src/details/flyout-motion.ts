import { createSignal, onCleanup } from "solid-js"
import { observeReducedMotion, prefersReducedMotion } from "@opencode/ui/motion"
import { motionTuning } from "@opencode/ui/motion-tuning"

// The Extensions submenu's motion (fading in beside its row, gliding between rows and resizing to each list) is off
// unless this knob is on. Off, the submenu shows, moves and resizes on the frame it changes.
const toggle = motionTuning.toggle("details.flyout.motion", {
  label: "Extensions submenu motion",
  group: "Header",
  subsection: "Extensions",
  description: "The submenu fading in beside its row, gliding between rows and resizing to each list",
  target: ".session-service-flyout",
  value: false,
})

/** Whether the Extensions submenu animates: only with its knob on, and never under reduced motion. Reactive; call it
 * inside a component so its listeners end with it. */
export function createFlyoutMotion() {
  const read = () => toggle() && !prefersReducedMotion()
  const [motion, setMotion] = createSignal(read())

  onCleanup(motionTuning.subscribe(() => setMotion(read())))
  onCleanup(observeReducedMotion(() => setMotion(read())))

  return motion
}

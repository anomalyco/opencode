import { motionTuning } from "@opencode/ui/motion-tuning"
import { createStore } from "solid-js/store"

// GitHub links are looked up from this device, which tells GitHub which repositories and pull requests were shown.
const enabled = motionTuning.toggle("linkPreviews.enabled", {
  label: "Enabled",
  group: "Experiments",
  subsection: "Link previews",
  description: "The links a reply names, listed under it with GitHub titles and states",
  target: '[data-component="link-previews"]',
  experiment: true,
  value: false,
})

const [state, setState] = createStore({ enabled: enabled() })

motionTuning.subscribe(() => setState({ enabled: enabled() }))

/** Experiment: a finished reply's links as compact rows above its copy footer. */
export const linkPreviewsExperiment = state

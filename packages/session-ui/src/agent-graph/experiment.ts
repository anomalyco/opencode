import { motionTuning } from "@opencode/ui/motion-tuning"
import { createStore } from "solid-js/store"

const enabled = motionTuning.toggle("agentGraph.enabled", {
  label: "Enabled",
  group: "Experiments",
  subsection: "Agent graph",
  description: "Sessions this Session spawns, and the messages between them",
  target: '[data-component="agent-graph"]',
  experiment: true,
  value: false,
})

const [state, setState] = createStore({ enabled: enabled() })

motionTuning.subscribe(() => setState({ enabled: enabled() }))

/** Experiment: a graph of the Session family with directed agent-to-agent messages, in the side panel. */
export const agentGraphExperiment = state

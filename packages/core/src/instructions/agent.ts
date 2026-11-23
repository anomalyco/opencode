export * as AgentInstructions from "./agent.js"

import { Agent } from "@opencode/schema/agent"
import { Effect, Schema } from "effect"
import { Instructions } from "./index.js"

const Selected = Schema.Struct({ id: Schema.String, name: Schema.String, text: Schema.String })
type Selected = typeof Selected.Type

const key = Instructions.Key.make("core/agent")
const codec = Schema.toCodecJson(Selected)

// Both texts name the agent: models only reliably drop the right instructions on leaving when the instructions were
// introduced under the agent's name, since the plugin's own text often doesn't mention it.
const active = (current: Selected) =>
  `You are the ${current.name} agent. Follow these instructions while you are the ${current.name} agent:\n\n${current.text}`

const inactive = (previous: Selected) =>
  `You are no longer the ${previous.name} agent. The instructions you followed as the ${previous.name} agent no longer apply. Do not keep following them.`

// One key for every agent: switching between two agents with instructions is one update.
export const make = (agent: Agent.Info): Instructions.List =>
  Instructions.make({
    key,
    codec,
    read: Effect.succeed(
      agent.instructions ? { id: agent.id, name: agent.name, text: agent.instructions } : Instructions.removed,
    ),
    render: {
      initial: active,
      changed: (previous, current) =>
        previous.id === current.id
          ? `Your instructions as the ${current.name} agent changed. These replace the previous ones:\n\n${current.text}`
          : `${inactive(previous)}\n\n${active(current)}`,
      removed: inactive,
    },
  })

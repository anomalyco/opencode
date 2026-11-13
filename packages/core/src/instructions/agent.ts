export * as AgentInstructions from "./agent.js"

import { Agent } from "@opencode/schema/agent"
import { Effect, Schema } from "effect"
import { Instructions } from "./index.js"

const Selected = Schema.Struct({ id: Schema.String, name: Schema.String, text: Schema.String })
type Selected = typeof Selected.Type

const key = Instructions.Key.make("core/agent")
const codec = Schema.toCodecJson(Selected)

const inactive = (previous: Selected) =>
  `The ${previous.name} agent is no longer selected. Its instructions from earlier in this conversation no longer apply.`

// One key for every agent: switching between two agents with instructions is one update.
export const make = (agent: Agent.Info): Instructions.List =>
  Instructions.make({
    key,
    codec,
    read: Effect.succeed(
      agent.instructions ? { id: agent.id, name: agent.name, text: agent.instructions } : Instructions.removed,
    ),
    render: {
      initial: (current) => current.text,
      changed: (previous, current) =>
        previous.id === current.id
          ? `The ${current.name} agent's instructions changed. These replace the previous ones:\n\n${current.text}`
          : `${inactive(previous)}\n\n${current.text}`,
      removed: inactive,
    },
  })

export * as AgentInstructions from "./agent.js"

import { Agent } from "@opencode/schema/agent"
import { Effect, Schema } from "effect"
import { Instructions } from "./index.js"

// The inactive text is stored with the value, so it can still be sent after the agent is edited or removed.
const Selected = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  active: Schema.String,
  inactive: Schema.String.pipe(Schema.optionalKey),
})
type Selected = typeof Selected.Type

const key = Instructions.Key.make("core/agent")
const codec = Schema.toCodecJson(Selected)

const inactive = (previous: Selected) =>
  previous.inactive ??
  `The ${previous.name} agent is no longer selected. Its instructions from earlier in this conversation no longer apply.`

// One key for every agent: switching between two agents with instructions is one update.
export const make = (agent: Agent.Info): Instructions.List =>
  Instructions.make({
    key,
    codec,
    read: Effect.succeed(selected(agent) ?? Instructions.removed),
    render: {
      initial: (current) => current.active,
      changed: (previous, current) => {
        if (previous.id !== current.id) return `${inactive(previous)}\n\n${current.active}`
        if (previous.active === current.active) return undefined
        return `The ${current.name} agent's instructions changed. These replace the previous ones:\n\n${current.active}`
      },
      removed: inactive,
    },
  })

function selected(agent: Agent.Info): Selected | undefined {
  if (!agent.instructions) return undefined
  if (typeof agent.instructions === "string")
    return { id: agent.id, name: agent.name, active: agent.instructions }
  if (!agent.instructions.active) return undefined
  return {
    id: agent.id,
    name: agent.name,
    active: agent.instructions.active,
    ...(agent.instructions.inactive ? { inactive: agent.instructions.inactive } : {}),
  }
}

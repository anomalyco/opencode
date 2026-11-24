export * as AgentInstructions from "./agent.js"

import { Agent } from "@opencode/schema/agent"
import { Effect, Schema } from "effect"
import { Instructions } from "./index.js"

// Both texts are stored with the value, so the unselected text can still be sent after the agent is edited or removed.
// `changed` is sent when the same agent's text changes mid-session.
const Selected = Schema.Struct({ id: Schema.String, active: Schema.String, inactive: Schema.String, changed: Schema.String })
type Selected = typeof Selected.Type

const key = Instructions.Key.make("core/agent")
const codec = Schema.toCodecJson(Selected)

// One key for every agent: switching between two agents with instructions is one update.
export const make = (agent: Agent.Info): Instructions.List =>
  Instructions.make({
    key,
    codec,
    read: Effect.succeed(selected(agent) ?? Instructions.removed),
    render: {
      initial: (current) => current.active,
      changed: (previous, current) => {
        if (previous.id !== current.id) return `${previous.inactive}\n\n${current.active}`
        if (previous.active === current.active) return undefined
        return current.changed
      },
      removed: (previous) => previous.inactive,
    },
  })

function selected(agent: Agent.Info): Selected | undefined {
  if (!agent.instructions) return undefined
  if (typeof agent.instructions !== "string")
    return {
      id: agent.id,
      active: agent.instructions.selected,
      inactive: agent.instructions.unselected,
      changed: agent.instructions.selected,
    }
  // A plugin's text often doesn't name its agent, so both texts do: models only reliably drop the right instructions
  // on leaving when they were introduced under the agent's name. The leave note says what still applies, or models
  // also drop constraints the user added while the agent was selected.
  return {
    id: agent.id,
    active: `You are the ${agent.name} agent. Follow these instructions while you are the ${agent.name} agent:\n\n${agent.instructions}`,
    changed: `Your instructions as the ${agent.name} agent changed. These replace the previous ones:\n\n${agent.instructions}`,
    inactive: `You are no longer the ${agent.name} agent. Stop following the instructions you were given as the ${agent.name} agent. Keep following anything the user asked for.`,
  }
}

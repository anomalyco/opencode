export * as Orchestrator from "."

import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Context, Effect, Layer, Schema } from "effect"

export const TeamMode = Schema.Literals(["parallel", "pipeline", "supervisor"])

export const TeamInput = Schema.Struct({
  agents: Schema.Array(Schema.String),
  mode: Schema.optional(TeamMode).pipe(Schema.withDecodingDefault(Effect.succeed("parallel" as const))),
  prompt: Schema.String,
  supervisor: Schema.optional(Schema.String),
})
export type TeamInput = Schema.Schema.Type<typeof TeamInput>

export interface Interface {
  readonly createTeamPrompt: (input: TeamInput) => Effect.Effect<string, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Orchestrator") {}

const MODE_DESC: Record<string, string> = {
  parallel: "Run all agents simultaneously. Each agent works on the task independently.",
  pipeline: "Run agents sequentially. Each receives the previous agent's output as context.",
  supervisor: "One supervisor agent delegates work and synthesizes the final result.",
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service

    const createTeamPrompt = Effect.fn("Orchestrator.createTeamPrompt")(function* (input: TeamInput) {
      const cfg = yield* config.get()
      const maxAgents = cfg.multiAgent?.maxAgents ?? 3
      if (input.agents.length > maxAgents) {
        return yield* Effect.fail(new Error(`Too many agents: ${input.agents.length} (max: ${maxAgents})`))
      }
      for (const name of input.agents) {
        if (!(yield* agent.get(name))) {
          return yield* Effect.fail(new Error(`Agent not found: ${name}`))
        }
      }

      const mode = input.mode ?? cfg.multiAgent?.defaultMode ?? "parallel"
      const agentsList = input.agents.map((n) => `- @${n}`).join("\n")
      const supervisorNote = mode === "supervisor"
        ? `\nSupervisor: @${input.supervisor ?? input.agents[0]}. Delegates tasks and synthesizes results.`
        : ""

      const prompt = [
        `## Team Coordination Task`,
        ``,
        input.prompt,
        ``,
        `### Agents:`,
        agentsList,
        ``,
        `### Mode: ${mode.toUpperCase()}`,
        MODE_DESC[mode],
        supervisorNote,
        ``,
        mode === "parallel"
          ? `Use the \`task\` tool for each agent with the full prompt. Then summarize all results.`
          : mode === "pipeline"
            ? `Start with agent 1. Pass its output as context to agent 2. Continue until done.`
            : `As supervisor, delegate subtasks to each agent using the \`task\` tool, then synthesize.`,
      ].join("\n")

      return prompt
    })

    return Service.of({ createTeamPrompt })
  }),
)

import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export const node = LayerNode.make({ service: Service, layer, deps: [Agent.node, Config.node] })

export { layer }

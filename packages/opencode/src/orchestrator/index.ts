export * as Orchestrator from "."

import { Context, Effect, Layer, Schema } from "effect"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"
import { SessionID, MessageID } from "@/session/schema"
import { Config } from "@/config/config"
import { Plugin } from "@/plugin"

export interface TeamAgentResult {
  agentName: string
  output: string
  error?: string
}

const TeamMode = Schema.Literals(["parallel", "pipeline", "supervisor"])

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

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const plugin = yield* Plugin.Service
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
      const modeDescriptions: Record<string, string> = {
        parallel: "Run all agents independently and simultaneously. Each works on the same task in parallel.",
        pipeline: "Run agents sequentially. Each agent receives the output of the previous agent as context.",
        supervisor: "One supervisor agent delegates work to the others and synthesizes the final result.",
      }

      const agentDescriptions: string[] = []
      for (const name of input.agents) {
        const ag = yield* agent.get(name)
        agentDescriptions.push(`- @${name}: ${ag?.description ?? ""}`)
      }

      const supervisorNote = input.supervisor
        ? `\nThe supervisor agent is @${input.supervisor}. It will delegate tasks and synthesize results.`
        : mode === "supervisor"
          ? `\nThe first agent (@${input.agents[0]}) acts as the supervisor.`
          : ""

      const prompt = [
        `## Team Coordination Task`,
        ``,
        `You are coordinating a team of agents to accomplish the following task:`,
        ``,
        input.prompt,
        ``,
        `### Available Agents`,
        ...agentDescriptions,
        ``,
        `### Execution Mode: ${mode.toUpperCase()}`,
        modeDescriptions[mode],
        supervisorNote,
        ``,
        `### Instructions`,
        mode === "parallel"
          ? [
              `1. For each agent, use the \`task\` tool to delegate the work.`,
              `   Pass the full task prompt and specify the subagent type.`,
              `2. Launch all agents. You can run them sequentially — the tool handles each one.`,
              `3. After all agents have completed, review their outputs and provide a summary.`,
            ].join("\n")
          : mode === "pipeline"
            ? [
                `1. Start with the first agent. Use the \`task\` tool to delegate.`,
                `2. Take that agent's output and pass it as context to the next agent.`,
                `3. Continue until all agents have contributed.`,
                `4. Provide the final pipeline output.`,
              ].join("\n")
            : [
                `1. As the supervisor, analyze the task and determine what each agent should work on.`,
                `2. Delegate to each agent using the \`task\` tool.`,
                `3. After receiving all results, synthesize them into a final response.`,
              ].join("\n"),
        ``,
        `### Output Format`,
        `Provide a summary of what each agent produced and the final result.`,
      ].join("\n")

      return prompt
    })

    return Service.of({ createTeamPrompt })
  }),
)

import { LayerNode } from "@opencode-ai/core/effect/layer-node"

export const node = LayerNode.make({ service: Service, layer, deps: [Agent.node, Config.node, Plugin.node, Session.node] })

export { layer }

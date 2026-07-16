export * as SessionModelRequest from "./model-request"

import { LLM, Message, SystemPart, type LLMRequest } from "@opencode-ai/ai"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { PluginHooks } from "../plugin/hooks"
import { ToolRegistry } from "../tool/registry"
import { SessionContext } from "./context"
import { SessionModelHeaders } from "./model-headers"
import { MAX_STEPS_PROMPT } from "./runner/max-steps"
import PROMPT_DEFAULT from "./runner/prompt/base.txt"
import { toLLMMessages } from "./runner/to-llm-message"

type ToolCallResolution =
  | { readonly type: "reject"; readonly error: SessionError.Error }
  | { readonly type: "settle"; readonly settle: ToolRegistry.Materialization["settle"] }

interface Prepared {
  readonly request: LLMRequest
  readonly retryAllowed: boolean
  readonly resolveToolCall: (name: string) => ToolCallResolution
}

interface PrepareInput {
  readonly context: SessionContext.Loaded
  readonly step: number
}

/**
 * Builds an outbound model request and captures the retry and tool-call
 * capabilities that must remain paired with it. It does not execute the
 * request or mutate Session state.
 */
export interface Interface {
  readonly prepare: (input: PrepareInput) => Effect.Effect<Prepared>
}

/** Location-scoped outbound model-request preparation. */
export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionModelRequest") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const registry = yield* ToolRegistry.Service

    const prepare = Effect.fn("SessionModelRequest.prepare")(function* (input: PrepareInput) {
      const session = input.context.session
      const agent = input.context.agent
      const resolved = input.context.model
      const model = resolved.model
      const providerMetadataKey = model.route.providerMetadataKey ?? model.provider
      const stepLimitReached = agent.info.steps !== undefined && input.step >= agent.info.steps
      const executableTools = stepLimitReached ? undefined : yield* registry.materialize(agent.info.permissions)
      const promptCacheKey = /^ses_[0-9a-f]{64}$/.test(session.id) ? session.id.slice(4) : session.id
      const system = [agent.info.system ? agent.info.system : PROMPT_DEFAULT, input.context.initial]
        .filter((part) => part.length > 0)
        .map(SystemPart.make)
      const history = toLLMMessages(input.context.messages, resolved.ref, providerMetadataKey)
      const messages = stepLimitReached ? [...history, Message.assistant(MAX_STEPS_PROMPT)] : history
      const toolsByName = new Map((executableTools?.definitions ?? []).map((tool) => [tool.name, tool]))
      // Hooks may reshape available definitions but cannot advertise tools omitted by permissions or the Step limit.
      const contextEvent = yield* hooks.trigger("session", "context", {
        sessionID: session.id,
        agent: agent.id,
        model: resolved.ref,
        system,
        messages,
        tools: Object.fromEntries(
          Array.from(toolsByName.values(), (tool) => [
            tool.name,
            { description: tool.description, input: { ...tool.inputSchema } },
          ]),
        ),
      })
      // Tools removed by context hooks remain non-executable for this request.
      const hookedTools = Object.entries(contextEvent.tools).reduce<Array<LLMRequest["tools"][number]>>(
        (result, [name, tool]) => {
          const registered = toolsByName.get(name)
          if (!registered) return result
          toolsByName.delete(name)
          result.push(Object.assign({}, registered, { description: tool.description, inputSchema: tool.input }))
          return result
        },
        [],
      )
      const request = LLM.request({
        model,
        http: {
          headers: SessionModelHeaders.make(session),
        },
        providerOptions: { openai: { promptCacheKey } },
        system: contextEvent.system,
        messages: contextEvent.messages,
        tools: hookedTools,
        toolChoice: stepLimitReached ? "none" : undefined,
      })
      const resolveToolCall = (name: string): ToolCallResolution => {
        if (!executableTools)
          return {
            type: "reject",
            error: { type: "tool.execution", message: "Tools are disabled after the maximum agent steps" },
          }
        if (toolsByName.has(name))
          return {
            type: "reject",
            error: { type: "tool.execution", message: `Tool is not available for this request: ${name}` },
          }
        return { type: "settle", settle: executableTools.settle }
      }
      return {
        request,
        retryAllowed: !stepLimitReached,
        resolveToolCall,
      }
    })

    return Service.of({ prepare })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [PluginHooks.node, ToolRegistry.node],
})

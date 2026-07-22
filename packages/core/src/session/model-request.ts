export * as SessionModelRequest from "./model-request"

import { LLM, Message, SystemPart, type LLMRequest, type ToolContent } from "@opencode-ai/ai"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Context, Effect, Layer } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { App } from "../app"
import { ModelV2 } from "../model"
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
  readonly resolveToolCall: (name: string) => ToolCallResolution
}

interface PrepareInput {
  readonly context: SessionContext.Loaded
  readonly step: number
}

const mimeToModality = (mime: string) => {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "pdf"
}

const unsupportedMedia = (mime: string, name: string | undefined, capabilities: ModelV2.Capabilities) => {
  const modality = mimeToModality(mime)
  if (!modality || capabilities.input.some((item) => item.startsWith(modality))) return
  return {
    type: "text" as const,
    text: `ERROR: Cannot read ${name ? `"${name}"` : modality} (this model does not support ${modality} input). Inform the user.`,
  }
}

export const unsupportedParts = (messages: LLMRequest["messages"], capabilities: ModelV2.Capabilities) =>
  messages.map((message) =>
    Message.make({
      ...message,
      content: message.content.map((part) => {
        if (part.type === "media") {
          return unsupportedMedia(part.mediaType, part.filename, capabilities) ?? part
        }
        if (part.type !== "tool-result" || part.result.type !== "content") return part
        return {
          ...part,
          result: {
            ...part.result,
            value: part.result.value.map((item: ToolContent) => {
              if (item.type !== "file") return item
              return unsupportedMedia(item.mime, item.name, capabilities) ?? item
            }),
          },
        }
      }),
    }),
  )

/**
 * Builds an outbound model request and captures the tool-call capability that
 * must remain paired with it. It does not execute the request or mutate
 * Session state.
 */
export interface Interface {
  /** Builds one outbound model request and its matching tool-call capability. */
  readonly prepare: (input: PrepareInput) => Effect.Effect<Prepared>
}

/** Location-scoped outbound model-request preparation. */
export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionModelRequest") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const registry = yield* ToolRegistry.Service
    const app = yield* App.Metadata

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
      const toolDefinitions = executableTools?.definitions ?? []
      const toolsByName = new Map(toolDefinitions.map((tool) => [tool.name, tool]))
      // Hooks may reshape available definitions but cannot advertise tools omitted by permissions or the Step limit.
      const contextEvent = yield* hooks.trigger("session", "context", {
        sessionID: session.id,
        agent: agent.id,
        model: resolved.ref,
        system,
        messages,
        tools: Object.fromEntries(
          toolDefinitions.map((tool) => [tool.name, { description: tool.description, input: { ...tool.inputSchema } }]),
        ),
      })
      const hookedTools = Object.entries(contextEvent.tools).flatMap(([name, tool]) => {
        const registered = toolsByName.get(name)
        return registered
          ? [Object.assign({}, registered, { description: tool.description, inputSchema: tool.input })]
          : []
      })
      const request = LLM.request({
        model,
        http: {
          headers: SessionModelHeaders.make(session, app),
        },
        providerOptions: { openai: { promptCacheKey } },
        system: contextEvent.system,
        messages: unsupportedParts(contextEvent.messages, resolved.capabilities),
        tools: hookedTools,
        toolChoice: stepLimitReached ? "none" : undefined,
      })
      const resolveToolCall = (name: string): ToolCallResolution => {
        if (!executableTools)
          return {
            type: "reject",
            error: { type: "tool.execution", message: "Tools are disabled after the maximum agent steps" },
          }
        if (toolsByName.has(name) && !Object.hasOwn(contextEvent.tools, name))
          return {
            type: "reject",
            error: { type: "tool.execution", message: `Tool is not available for this request: ${name}` },
          }
        return { type: "settle", settle: executableTools.settle }
      }
      return {
        request,
        resolveToolCall,
      }
    })

    return Service.of({ prepare })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [PluginHooks.node, ToolRegistry.node, App.node],
})

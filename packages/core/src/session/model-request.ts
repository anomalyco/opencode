export * as SessionModelRequest from "./model-request.js"

import { LLM, Message, SystemPart, type LLMRequest } from "@opencode-ai/ai"
import type { StreamOptions } from "@opencode-ai/ai/route"
import type { Content } from "@opencode-ai/schema/tool"
import { Cause, Config, Context, Effect, Layer, Result } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { App } from "../app.js"
import { Model } from "../model.js"
import { Provider } from "../provider.js"
import { Permission } from "../permission.js"
import { PluginHooks } from "../plugin/hooks.js"
import { QuestionTool } from "../tool/plugin/question.js"
import { Tool } from "../tool.js"
import { SessionModelHeaders } from "./model-headers.js"
import { SessionModelHook } from "./model-hook.js"
import { SessionModelHttp } from "./model-http.js"
import { SessionModelTransport } from "./model-transport.js"
import { SessionPromptCacheKey } from "./prompt-cache-key.js"
import { SessionRunnerModel } from "./runner/model.js"
import { SessionSchema } from "./schema.js"
import { SessionSystemPrompt } from "./system-prompt.js"
import { toLLMMessages } from "./runner/to-llm-message.js"
import type { SessionMessage } from "./message.js"
import type { Agent } from "../agent.js"

const IMAGE_BYTES_TRIGGER = 25 * 1024 * 1024 // 25 MiB
const IMAGE_BYTES_TARGET = 15 * 1024 * 1024 // 15 MiB
const IMAGE_REMOVED =
  "[This image was removed to reduce the request size and is no longer visible. Do not make claims about its contents from memory. If needed, retrieve it again with an available tool or ask the user to attach it again.]"

/** Failures a prepared execution can surface: infrastructure errors plus user declines resurfaced from the defect tunnel. */
export type ExecuteError = Tool.Error | Permission.DeclinedError | QuestionTool.CancelledError

// User declines dive under the leaves' blanket `mapError` as defects (the deliberate
// tunnel entered in Permission.assert and the question tool), so a user's "no" can
// never become model-facing tool output. They resurface as typed failures exactly once,
// here at the seam the runner executes through.
const declineDefect = (cause: Cause.Cause<Tool.Error>) => {
  const decline = cause.reasons.flatMap((reason) =>
    Cause.isDieReason(reason) &&
    (reason.defect instanceof Permission.DeclinedError || reason.defect instanceof QuestionTool.CancelledError)
      ? [reason.defect]
      : [],
  )[0]
  return decline ? Result.succeed(decline) : Result.fail(cause)
}

interface Prepared {
  readonly request: LLMRequest
  readonly options: StreamOptions
  /**
   * One request-scoped execution operation. Unknown and hook-removed calls
   * fail individually through the same seam.
   */
  readonly executeTool: (input: Parameters<Tool.Snapshot["execute"]>[0]) => Effect.Effect<Tool.Result, ExecuteError>
}

interface PrepareInput {
  readonly scope: {
    readonly session: SessionSchema.Info
    readonly agentID: Agent.ID
    readonly model: SessionRunnerModel.Resolved
    readonly tools: Tool.Snapshot
  }
  readonly transcript: {
    readonly system: Array<SystemPart>
    readonly messages: Array<Message>
  }
  readonly toolChoice?: LLM.RequestInput["toolChoice"]
  /** Stateful Session WebSocket channels require an explicit durable-runner opt-in. */
  readonly webSocket?: "session"
}

export const baseTranscript = (input: {
  readonly agent: Agent.Info
  readonly model: SessionRunnerModel.Resolved
  readonly tools: Tool.Snapshot
  readonly initial: string
  readonly messages: ReadonlyArray<SessionMessage.Info>
}) => {
  const providerMetadataKey = input.model.model.route.providerMetadataKey ?? input.model.model.provider
  return {
    providerMetadataKey,
    system: [
      input.agent.system
        ? input.agent.system
        : SessionSystemPrompt.make(input.tools.definitions.map((tool) => tool.name)),
      input.initial,
    ]
      .filter((part) => part.length > 0)
      .map(SystemPart.make),
    messages: toLLMMessages(input.messages, input.model.ref, providerMetadataKey),
  }
}

const mimeToModality = (mime: string) => {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "pdf"
}

const unsupportedMedia = (mime: string, name: string | undefined, capabilities: Model.Capabilities) => {
  const modality = mimeToModality(mime)
  if (!modality || capabilities.input.some((item) => item.startsWith(modality))) return
  return {
    type: "text" as const,
    text: `ERROR: Cannot read ${name ? `"${name}"` : modality} (this model does not support ${modality} input). Inform the user.`,
  }
}

export const unsupportedParts = (messages: LLMRequest["messages"], capabilities: Model.Capabilities) =>
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
            value: part.result.value.map((item: Content) => {
              if (item.type !== "file") return item
              return unsupportedMedia(item.mime, item.name, capabilities) ?? item
            }),
          },
        }
      }),
    }),
  )

export const boundImages = (messages: LLMRequest["messages"]) => {
  const isImage = (mime: string) => mime.toLowerCase().startsWith("image/")
  const size = (data: string | Uint8Array) =>
    typeof data === "string" ? Buffer.byteLength(data) : Math.ceil(data.byteLength / 3) * 4
  const imageBytes = messages.reduce(
    (total, message) =>
      total +
      message.content.reduce((sum, part) => {
        if (part.type === "media" && isImage(part.mediaType)) return sum + size(part.data)
        if (part.type !== "tool-result" || part.result.type !== "content") return sum
        return (
          sum +
          part.result.value.reduce(
            (bytes: number, item: Content) =>
              bytes + (item.type === "file" && isImage(item.mime) ? Buffer.byteLength(item.uri) : 0),
            0,
          )
        )
      }, 0),
    0,
  )
  if (imageBytes <= IMAGE_BYTES_TRIGGER) return messages

  let removed = 0
  return messages.map((message) =>
    Message.make({
      ...message,
      content: message.content.map((part) => {
        if (part.type === "media" && isImage(part.mediaType) && imageBytes - removed > IMAGE_BYTES_TARGET) {
          removed += size(part.data)
          return Message.text(IMAGE_REMOVED)
        }
        if (part.type !== "tool-result" || part.result.type !== "content") return part
        return {
          ...part,
          result: {
            ...part.result,
            value: part.result.value.map((item: Content) => {
              if (item.type !== "file" || !isImage(item.mime) || imageBytes - removed <= IMAGE_BYTES_TARGET) return item
              removed += Buffer.byteLength(item.uri)
              return { type: "text" as const, text: IMAGE_REMOVED }
            }),
          },
        }
      }),
    }),
  )
}

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
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionModelRequest") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const transport = yield* SessionModelTransport.Service
    const app = yield* App.Metadata
    const webSocket = yield* Config.boolean("OPENCODE_EXPERIMENTAL_OPENAI_RESPONSES_WEBSOCKET").pipe(
      Config.withDefault(false),
      Effect.orDie,
    )
    const prepare = Effect.fn("SessionModelRequest.prepare")(function* (input: PrepareInput) {
      const session = input.scope.session
      const resolved = input.scope.model
      const model = resolved.model
      const tools = input.scope.tools
      const registry = new Map(tools.definitions.map((tool) => [tool.name, tool]))
      // The definition objects we hand to hooks, mapped back to their tools. Hooks rename a
      // tool by moving its definition to a new key; recognizing the object recovers the tool.
      const given = new Map(
        tools.definitions.map(
          (tool) => [{ description: tool.description, input: { ...tool.inputSchema } }, tool] as const,
        ),
      )
      // Hooks mutate this record in place: edit descriptions and schemas, rename, or remove.
      const context = yield* hooks.trigger("session", "context", {
        sessionID: session.id,
        agent: input.scope.agentID,
        model: resolved.ref,
        system: input.transcript.system,
        messages: input.transcript.messages,
        tools: Object.fromEntries(Array.from(given, ([definition, tool]) => [tool.name, definition])),
      })
      // Match each surviving entry back to its tool, by recognizing a moved definition or
      // by key. Identity wins so a definition moved onto another tool's name still executes
      // the tool it describes. Entries matching neither were invented by a hook and dropped.
      // `tool.name` stays canonical so execution can translate renamed calls back.
      const hooked = new Map(
        Object.entries(context.tools).flatMap(([name, definition]) => {
          const tool = given.get(definition) ?? registry.get(name)
          if (!tool) return []
          return [[name, { ...tool, description: definition.description, inputSchema: definition.input }] as const]
        }),
      )
      const request = yield* SessionModelHook.apply(
        hooks,
        { sessionID: session.id, agent: input.scope.agentID, model: resolved.ref },
        LLM.request({
          model,
          http: {
            headers: SessionModelHeaders.make(session, app),
          },
          // TODO: Persist cache lineage so nested forks reuse the root session's cache key.
          promptCacheKey: SessionPromptCacheKey.make(session.fork?.sessionID ?? session.id),
          system: context.system,
          messages: boundImages(unsupportedParts(context.messages, resolved.capabilities)),
          tools: Array.from(hooked, ([name, tool]) => ({ ...tool, name })),
          toolChoice: input.toolChoice,
        }),
      )
      const webSocketEligible =
        !(yield* hooks.has("session", "http.request", resolved.ref.providerID)) &&
        !(yield* hooks.has("session", "http.response", resolved.ref.providerID))
      const http = webSocketEligible
        ? undefined
        : SessionModelHttp.middleware(hooks, {
            sessionID: session.id,
            agent: input.scope.agentID,
            model: resolved.ref,
          })
      const options: StreamOptions = {
        ...(http ? { http } : {}),
        ...(input.webSocket === "session" &&
        webSocket &&
        webSocketEligible &&
        resolved.ref.providerID === Provider.ID.openai &&
        request.model.route.id === "openai-responses"
          ? { webSocket: transport.bind(session.id) }
          : {}),
      }
      const executeTool: Prepared["executeTool"] = (input) => {
        const tool = hooked.get(input.call.name)
        // A registered tool absent from the hooked set was removed or renamed by a hook.
        if (!tool && registry.has(input.call.name))
          return new Tool.Error({ message: `Tool is not available for this request: ${input.call.name}` })
        return tools
          .execute(tool ? { ...input, call: { ...input.call, name: tool.name } } : input)
          .pipe(Effect.catchCauseFilter(declineDefect, (decline) => Effect.fail(decline)))
      }
      return {
        request,
        options,
        executeTool,
      }
    })

    return Service.of({ prepare })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [PluginHooks.node, SessionModelTransport.node, App.node],
})

export * as SessionModelRequest from "./model-request.js"

import { LLM, Message, SystemPart, type LLMRequest } from "@opencode-ai/ai"
import type { StreamOptions } from "@opencode-ai/ai/route"
import type { Content } from "@opencode-ai/schema/tool"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Cause, Config, Context, Effect, Layer, Result } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { App } from "../app.js"
import { Model } from "../model.js"
import { Permission } from "../permission.js"
import { PluginHooks } from "../plugin/hooks.js"
import { QuestionTool } from "../tool/plugin/question.js"
import { Tool } from "../tool.js"
import { SessionContext } from "./context.js"
import { SessionModelHeaders } from "./model-headers.js"
import { SessionModelHttp } from "./model-http.js"
import { SessionPromptCacheKey } from "./prompt-cache-key.js"
import { PromptCacheDiagnostics } from "./prompt-cache-diagnostics.js"
import { MAX_STEPS_PROMPT } from "./runner/max-steps.js"
import PROMPT_DEFAULT from "./runner/prompt/base.txt"
import { toLLMMessages } from "./runner/to-llm-message.js"

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
   * One request-scoped execution operation. Unknown, hook-removed, and
   * step-limit-violating calls fail individually through the same seam.
   */
  readonly executeTool: (input: Parameters<Tool.Snapshot["execute"]>[0]) => Effect.Effect<Tool.Result, ExecuteError>
  /** True when this request is the final Step; violating calls are rejected and no continuation follows. */
  readonly stepLimitReached: boolean
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
    const app = yield* App.Metadata
    const diagnostics = yield* Config.boolean("OPENCODE_PROMPT_CACHE_DIAGNOSTICS").pipe(
      Config.withDefault(false),
      Effect.orDie,
    )
    const promptCacheSnapshots = diagnostics ? new Map<string, PromptCacheDiagnostics.Snapshot>() : undefined

    const prepare = Effect.fn("SessionModelRequest.prepare")(function* (input: PrepareInput) {
      const session = input.context.session
      const agent = input.context.agent
      const resolved = input.context.model
      const model = resolved.model
      const providerMetadataKey = model.route.providerMetadataKey ?? model.provider
      const stepLimitReached = agent.info.steps !== undefined && input.step >= agent.info.steps
      // The final Step keeps definitions available to protocols with native "none",
      // preserving their prompt cache prefix. Calls are still rejected at execution.
      const tools = input.context.tools
      const system = [agent.info.system ? agent.info.system : PROMPT_DEFAULT, input.context.initial]
        .filter((part) => part.length > 0)
        .map(SystemPart.make)
      const history = toLLMMessages(input.context.messages, resolved.ref, providerMetadataKey)
      const messages = stepLimitReached ? [...history, Message.assistant(MAX_STEPS_PROMPT)] : history
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
        agent: agent.id,
        model: resolved.ref,
        system,
        messages,
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
      const request = LLM.request({
        model,
        http: {
          headers: SessionModelHeaders.make(session, app),
        },
        promptCacheKey: SessionPromptCacheKey.make(session.id),
        system: context.system,
        messages: boundImages(unsupportedParts(context.messages, resolved.capabilities)),
        tools: Array.from(hooked, ([name, tool]) => ({ ...tool, name })),
        toolChoice: stepLimitReached ? "none" : undefined,
      })
      const options: StreamOptions = {
        http: SessionModelHttp.middleware(hooks, {
          sessionID: session.id,
          agent: agent.id,
          model: resolved.ref,
        }),
      }
      if (promptCacheSnapshots) {
        const current = PromptCacheDiagnostics.snapshot(request)
        const comparison = PromptCacheDiagnostics.compare(promptCacheSnapshots.get(session.id), current)
        promptCacheSnapshots.delete(session.id)
        promptCacheSnapshots.set(session.id, current)
        const oldest = promptCacheSnapshots.keys().next().value
        if (promptCacheSnapshots.size > 100 && oldest !== undefined) promptCacheSnapshots.delete(oldest)
        yield* Effect.logInfo("prompt cache prefix").pipe(
          Effect.annotateLogs({
            sessionID: session.id,
            toolCount: current.tools.length,
            systemParts: current.system.length,
            messageCount: current.messages.length,
            ...comparison,
          }),
        )
      }
      const executeTool: Prepared["executeTool"] = (input) => {
        if (stepLimitReached) return new Tool.Error({ message: "Tools are disabled after the maximum agent steps" })
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
        stepLimitReached,
      }
    })

    return Service.of({ prepare })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [PluginHooks.node, App.node],
})

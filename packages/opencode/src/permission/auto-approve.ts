import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { LLMEvent } from "@opencode-ai/llm"
import { Context, Effect, Layer, Stream } from "effect"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { Session } from "@/session/session"
import type { Agent } from "@/agent/agent"
import PROMPT from "./auto-approve.txt"

export const policy = PROMPT

const USER_REQUEST_MAX = 4_000
const PATTERN_COUNT_MAX = 10
const PATTERN_MAX = 512
const ACTION_MAX = 12_000
const METADATA_STRING_MAX = 8_000
const METADATA_ARRAY_MAX = 8
const METADATA_ARRAY_ITEM_MAX = 256

const agent: Agent.Info = {
  name: "auto-approve",
  mode: "primary",
  native: true,
  hidden: true,
  temperature: 0,
  permission: [],
  prompt: PROMPT,
  options: {},
}

export interface Interface {
  readonly classify: (request: PermissionV1.Request) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PermissionAutoApprove") {}

type ActionValue = string | number | boolean | string[]

function selectMetadata(request: PermissionV1.Request, required: string[], optional: string[]) {
  const fields = [...required, ...optional]
  if (Object.keys(request.metadata).some((key) => !fields.includes(key))) return
  const fieldsWithValues = fields.map((key) => {
    const value = request.metadata[key]
    if (value === undefined) return { valid: true }
    if (typeof value === "string" && value.length > 0 && value.length <= METADATA_STRING_MAX)
      return { valid: true, entry: [key, value] as const }
    if (typeof value === "number" && Number.isFinite(value)) return { valid: true, entry: [key, value] as const }
    if (typeof value === "boolean") return { valid: true, entry: [key, value] as const }
    if (
      Array.isArray(value) &&
      value.length <= METADATA_ARRAY_MAX &&
      value.every((item) => typeof item === "string" && item.length <= METADATA_ARRAY_ITEM_MAX)
    )
      return { valid: true, entry: [key, value] as const }
    return { valid: false }
  })
  if (fieldsWithValues.some((field) => !field.valid)) return
  const entries = fieldsWithValues.flatMap(
    (field): Array<readonly [string, ActionValue]> => (field.entry ? [field.entry] : []),
  )
  const metadata = Object.fromEntries(entries)
  if (required.some((key) => !(key in metadata))) return
  return metadata
}

export function action(request: PermissionV1.Request) {
  if (
    request.patterns.length === 0 ||
    request.patterns.length > PATTERN_COUNT_MAX ||
    request.patterns.some((item) => item.length === 0 || item.length > PATTERN_MAX)
  )
    return

  const metadata = (() => {
    if (request.permission === "bash") {
      if (request.patterns.includes("*")) return
      return selectMetadata(request, ["command"], [])
    }
    if (request.permission === "external_directory") {
      if (typeof request.metadata.command === "string") {
        const selected = selectMetadata(request, ["command", "directories", "patterns"], [])
        if (
          !selected ||
          !Array.isArray(selected.patterns) ||
          selected.patterns.length !== request.patterns.length ||
          selected.patterns.some((pattern, index) => pattern !== request.patterns[index])
        )
          return
        return selected
      }
      return selectMetadata(request, ["filepath", "parentDir"], [])
    }
    if (request.permission === "edit") return selectMetadata(request, ["filepath", "diff"], [])
    if (request.permission === "webfetch") {
      const selected = selectMetadata(request, ["url"], ["format", "timeout"])
      if (!selected || request.patterns.length !== 1 || request.patterns[0] !== selected.url) return
      return selected
    }
    if (request.permission === "websearch") {
      const selected = selectMetadata(
        request,
        ["query"],
        ["numResults", "livecrawl", "type", "contextMaxCharacters", "provider"],
      )
      if (!selected || request.patterns.length !== 1 || request.patterns[0] !== selected.query) return
      return selected
    }
    if (request.permission === "grep") {
      const selected = selectMetadata(request, ["pattern"], ["path", "include"])
      if (!selected || request.patterns.length !== 1 || request.patterns[0] !== selected.pattern) return
      return selected
    }
    if (request.permission === "glob") {
      const selected = selectMetadata(request, ["pattern"], ["path"])
      if (!selected || request.patterns.length !== 1 || request.patterns[0] !== selected.pattern) return
      return selected
    }
    if (request.permission === "lsp") {
      if (request.patterns.length !== 1 || request.patterns[0] !== "*") return
      const operation = request.metadata.operation
      if (operation === "workspaceSymbol") {
        const query = request.metadata.query
        if (
          Object.keys(request.metadata).some((key) => key !== "operation" && key !== "query") ||
          typeof query !== "string" ||
          query.length > METADATA_STRING_MAX
        )
          return
        return { operation, query }
      }
      if (operation === "documentSymbol") return selectMetadata(request, ["operation", "filePath"], [])
      if (
        ![
          "goToDefinition",
          "findReferences",
          "hover",
          "goToImplementation",
          "prepareCallHierarchy",
          "incomingCalls",
          "outgoingCalls",
        ].includes(typeof operation === "string" ? operation : "")
      )
        return
      const selected = selectMetadata(request, ["operation", "filePath", "line", "character"], [])
      if (
        !selected ||
        typeof selected.line !== "number" ||
        !Number.isInteger(selected.line) ||
        selected.line < 1 ||
        typeof selected.character !== "number" ||
        !Number.isInteger(selected.character) ||
        selected.character < 1
      )
        return
      return selected
    }
    if (request.permission === "task") {
      const selected = selectMetadata(
        request,
        ["description", "prompt", "subagent_type"],
        ["background", "task_id", "command"],
      )
      if (!selected || request.patterns.length !== 1 || request.patterns[0] !== selected.subagent_type) return
      return selected
    }
    if (request.permission === "read") {
      if (request.patterns.includes("*")) return
      if (request.patterns.some((pattern) => pattern.startsWith("mcp:"))) {
        const selected = selectMetadata(request, ["server", "uri"], [])
        if (
          !selected ||
          request.patterns.length !== 1 ||
          request.patterns[0] !== `mcp:${selected.server}:${selected.uri}`
        )
          return
        return selected
      }
      return selectMetadata(request, [], [])
    }
    if (request.permission === "skill") {
      if (request.patterns.includes("*")) return
      return selectMetadata(request, [], [])
    }
  })()
  if (!metadata) return

  const descriptor = { permission: request.permission, patterns: request.patterns, metadata }
  if (JSON.stringify(descriptor).length > ACTION_MAX) return
  return descriptor
}

export function evidence(request: PermissionV1.Request, history: SessionV1.WithParts[]) {
  if (!request.tool) return
  const toolIndex = history.findIndex((item) => item.info.id === request.tool?.messageID)
  if (toolIndex === -1) return
  const toolMessage = history[toolIndex]
  if (toolMessage.info.role !== "assistant") return
  if (
    toolMessage.info.sessionID !== request.sessionID ||
    !toolMessage.parts.some((part) => part.type === "tool" && part.callID === request.tool?.callID)
  )
    return

  const parentID = toolMessage.info.parentID
  const parentIndex = history.findIndex((item) => item.info.id === parentID)
  const parent = history[parentIndex]
  if (
    parentIndex === -1 ||
    parentIndex >= toolIndex ||
    parent.info.role !== "user" ||
    parent.info.sessionID !== request.sessionID
  )
    return

  const userRequest = parent.parts
    .flatMap((part) => {
      if (part.type === "text" && !part.synthetic && !part.ignored) return [part.text]
      return []
    })
    .join("\n")
    .trim()
  if (!userRequest || userRequest.length > USER_REQUEST_MAX) return
  const descriptor = action(request)
  if (!descriptor) return

  return {
    user: parent.info,
    input: {
      userRequest,
      action: descriptor,
    },
  }
}

export function approved(events: ReadonlyArray<LLMEvent>) {
  const finishes = events.filter(LLMEvent.is.finish)
  if (finishes.length !== 1 || finishes[0].reason !== "stop") return false
  const finishIndex = events.indexOf(finishes[0])
  if (finishIndex !== events.length - 1) return false
  const stepStarts = events.filter(LLMEvent.is.stepStart)
  const stepFinishes = events.filter(LLMEvent.is.stepFinish)
  if (stepStarts.length > 0 || stepFinishes.length > 0) {
    if (stepStarts.length !== 1 || stepFinishes.length !== 1) return false
    if (stepFinishes[0].reason !== "stop" || stepStarts[0].index !== stepFinishes[0].index) return false
    const startIndex = events.indexOf(stepStarts[0])
    const stepFinishIndex = events.indexOf(stepFinishes[0])
    if (!(startIndex < stepFinishIndex && stepFinishIndex < finishIndex)) return false
    if (
      events.some((event, index) => LLMEvent.is.textDelta(event) && (index <= startIndex || index >= stepFinishIndex))
    )
      return false
  }
  if (events.some(LLMEvent.is.providerError)) return false
  if (
    events.some(
      (event) =>
        LLMEvent.is.reasoningStart(event) || LLMEvent.is.reasoningDelta(event) || LLMEvent.is.reasoningEnd(event),
    )
  )
    return false
  if (
    events.some(
      (event) =>
        LLMEvent.is.toolInputStart(event) ||
        LLMEvent.is.toolInputDelta(event) ||
        LLMEvent.is.toolInputEnd(event) ||
        LLMEvent.is.toolCall(event) ||
        LLMEvent.is.toolResult(event) ||
        LLMEvent.is.toolError(event),
    )
  )
    return false
  const textStarts = events.filter(LLMEvent.is.textStart)
  const textEnds = events.filter(LLMEvent.is.textEnd)
  const textDeltas = events.filter(LLMEvent.is.textDelta)
  if (textStarts.length > 0 || textEnds.length > 0) {
    if (textStarts.length !== 1 || textEnds.length !== 1) return false
    const start = textStarts[0]
    const end = textEnds[0]
    if (start.id !== end.id || textDeltas.some((event) => event.id !== start.id)) return false
    const startIndex = events.indexOf(start)
    const endIndex = events.indexOf(end)
    if (startIndex >= endIndex || endIndex >= finishIndex) return false
    if (textDeltas.some((event) => events.indexOf(event) <= startIndex || events.indexOf(event) >= endIndex))
      return false
    if (
      stepStarts.length === 1 &&
      (startIndex <= events.indexOf(stepStarts[0]) || endIndex >= events.indexOf(stepFinishes[0]))
    )
      return false
  }
  return textDeltas.map((event) => event.text).join("") === "AUTO_APPROVE"
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const session = yield* Session.Service

    const run = Effect.fn("PermissionAutoApprove.classify")(function* (request: PermissionV1.Request) {
      const history = yield* session.messages({ sessionID: request.sessionID })
      const context = evidence(request, history)
      if (!context) return false

      const cfg = yield* config.get()
      const hasConfigured = cfg.auto_approve !== undefined && Object.hasOwn(cfg.auto_approve, "model")
      const configuredValue = cfg.auto_approve?.model
      const configured =
        typeof configuredValue === "string" && /^[^/\s]+\/\S+$/.test(configuredValue)
          ? Provider.parseModel(configuredValue)
          : undefined
      if (hasConfigured && !configured) {
        yield* Effect.logWarning("auto-approve classification unavailable", {
          requestID: request.id,
          category: "invalid_configured_model",
        })
        return false
      }
      const model = configured
        ? yield* provider.getModel(configured.providerID, configured.modelID)
        : yield* provider.getSmallModel(context.user.model.providerID)
      if (!model || (!configured && model.providerID !== context.user.model.providerID)) {
        yield* Effect.logWarning("auto-approve classification unavailable", {
          requestID: request.id,
          category: "model_unavailable",
        })
        return false
      }

      const events = yield* llm
        .stream({
          agent,
          user: {
            ...context.user,
            system: undefined,
            model: { providerID: model.providerID, modelID: model.id },
          },
          system: [],
          small: true,
          tools: {},
          toolChoice: "none",
          model,
          sessionID: request.sessionID,
          retries: 0,
          maxOutputTokens: 16,
          messages: [
            {
              role: "user",
              content: JSON.stringify(context.input),
            },
          ],
        })
        .pipe(Stream.runCollect)

      return approved(events)
    })

    const classify: Interface["classify"] = (request) =>
      run(request).pipe(
        Effect.timeoutOrElse({
          duration: "5 seconds",
          orElse: () =>
            Effect.logWarning("auto-approve classification failed", {
              requestID: request.id,
              category: "timeout",
            }).pipe(Effect.as(false)),
        }),
        Effect.catchCause(() =>
          Effect.logWarning("auto-approve classification failed", {
            requestID: request.id,
            category: "model_or_context_error",
          }).pipe(Effect.as(false)),
        ),
      )

    return Service.of({ classify })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, Provider.node, LLM.node, Session.node],
})

export * as PermissionAutoApprove from "./auto-approve"

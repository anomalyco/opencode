import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { LLMEvent } from "@opencode-ai/llm"
import { Context, Deferred, Effect, Layer, Stream } from "effect"
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
const TOOL_INPUT_MAX = 4_000
const INPUT_MAX = ACTION_MAX + USER_REQUEST_MAX + TOOL_INPUT_MAX + 4_000
// The verdict is one word, but a reasoning model spends output tokens before it.
// 512 covers a minimal reasoning trace plus the verdict, stays an order of
// magnitude under the ~5k input tokens each classification already sends, and
// streams well inside the 15s deadline. Extra tokens cannot approve anything:
// approved() still requires the entire text to be exactly AUTO_APPROVE.
const MAX_OUTPUT_TOKENS = 512

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
  readonly classify: (request: PermissionV1.Request) => Effect.Effect<PermissionV1.ClassificationResult>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PermissionAutoApprove") {}

type ActionValue = string | number | boolean | string[]

function selectMetadata(request: PermissionV1.Request, required: string[], optional: string[], ignored: string[] = []) {
  const fields = [...required, ...optional]
  if (Object.keys(request.metadata).some((key) => !fields.includes(key) && !ignored.includes(key))) return
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
    if (request.permission === "edit") {
      const files = request.metadata.files
      if (
        files !== undefined &&
        (!Array.isArray(files) ||
          files.some(
            (file) => typeof file !== "object" || file === null || ("movePath" in file && file.movePath !== undefined),
          ))
      )
        return
      return selectMetadata(request, ["filepath", "diff"], [], ["files"])
    }
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
      const selected = selectMetadata(request, ["offset", "limit"], [])
      if (
        !selected ||
        typeof selected.offset !== "number" ||
        !Number.isInteger(selected.offset) ||
        selected.offset < 1 ||
        typeof selected.limit !== "number" ||
        !Number.isInteger(selected.limit) ||
        selected.limit < 1
      )
        return
      return selected
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
  if (toolMessage.info.sessionID !== request.sessionID) return
  const toolPart = toolMessage.parts.find(
    (part): part is SessionV1.ToolPart => part.type === "tool" && part.callID === request.tool?.callID,
  )
  if (!toolPart) return

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

  const toolInput = (() => {
    const value = toolPart.state.input
    if (typeof value !== "object" || value === null || Array.isArray(value)) return
    const serialized = (() => {
      try {
        return JSON.stringify(value)
      } catch {
        return undefined
      }
    })()
    if (serialized === undefined || serialized.length > TOOL_INPUT_MAX) return
    return value
  })()

  const input = {
    userRequest,
    toolCall: {
      name: toolPart.tool,
      ...(toolInput ? { input: toolInput } : {}),
    },
    action: descriptor,
  }
  if (JSON.stringify(input).length > INPUT_MAX) return

  return {
    user: parent.info,
    input,
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
  if (reasoning(events)) return false
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
  if (textDeltas.some((event) => event.id !== textDeltas[0].id)) return false
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
  return output(events) === "AUTO_APPROVE"
}

export function output(events: ReadonlyArray<LLMEvent>) {
  return events
    .filter(LLMEvent.is.textDelta)
    .map((event) => event.text)
    .join("")
}

export function reasoning(events: ReadonlyArray<LLMEvent>) {
  return events.some(
    (event) =>
      LLMEvent.is.reasoningStart(event) || LLMEvent.is.reasoningDelta(event) || LLMEvent.is.reasoningEnd(event),
  )
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const session = yield* Session.Service
    const active = new WeakMap<PermissionV1.Request, Deferred.Deferred<PermissionV1.ClassificationResult>>()

    const run = Effect.fn("PermissionAutoApprove.classify")(function* (request: PermissionV1.Request) {
      const cfg = yield* config.get()
      const detailed = cfg.auto_approve?.show_details === true
      const unavailable = (category: string): PermissionV1.ClassificationResult =>
        detailed
          ? { approved: false, details: { input: "", output: `(unavailable: ${category})` } }
          : { approved: false }

      if (cfg.experimental?.auto_approve !== true) {
        yield* Effect.logWarning("auto-approve classification unavailable", {
          requestID: request.id,
          category: "disabled",
        })
        return unavailable("disabled")
      }

      const info = yield* session.get(request.sessionID)
      if (info.parentID) {
        yield* Effect.logWarning("auto-approve classification unavailable", {
          requestID: request.id,
          category: "subagent_session",
        })
        return unavailable("subagent_session")
      }

      const history = yield* session.messages({ sessionID: request.sessionID })
      const context = evidence(request, history)
      if (!context) return unavailable("not_classifiable")

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
        return unavailable("invalid_configured_model")
      }
      const model = configured
        ? yield* provider.getModel(configured.providerID, configured.modelID)
        : yield* provider.getSmallModel(context.user.model.providerID)
      if (!model) {
        yield* Effect.logWarning("auto-approve classification unavailable", {
          requestID: request.id,
          category: "model_unavailable",
        })
        return unavailable("model_unavailable")
      }
      if (!configured && model.providerID !== context.user.model.providerID) {
        yield* Effect.logWarning("auto-approve classification unavailable", {
          requestID: request.id,
          category: "model_provider_mismatch",
        })
        return unavailable("model_provider_mismatch")
      }
      const input = JSON.stringify(context.input)
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
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          messages: [
            {
              role: "user",
              content: input,
            },
          ],
        })
        .pipe(Stream.runCollect)

      const decision = approved(events)
      const text = output(events)
      // approved() rejects reasoning outright, so without this the trace would read
      // "AUTO_APPROVE" next to a refusal.
      const rejected = !decision && reasoning(events) && text.trim() === "AUTO_APPROVE" ? "(rejected: reasoning_output)" : undefined
      yield* Effect.logInfo("auto-approve classification", {
        requestID: request.id,
        sessionID: request.sessionID,
        providerID: model.providerID,
        modelID: model.id,
        decision: decision ? "AUTO_APPROVE" : "ASK",
      })
      return {
        approved: decision,
        ...(detailed ? { details: { input, output: [rejected, text].filter(Boolean).join(" ") } } : {}),
      }
    })

    const failed = (request: PermissionV1.Request, category: string) =>
      Effect.gen(function* () {
        yield* Effect.logWarning("auto-approve classification failed", {
          requestID: request.id,
          category,
        })
        const detailed = yield* config.get().pipe(
          Effect.map((cfg) => cfg.auto_approve?.show_details === true),
          Effect.catchCause(() => Effect.succeed(false)),
        )
        return (
          detailed
            ? { approved: false, details: { input: "", output: `(failed: ${category})` } }
            : { approved: false }
        ) satisfies PermissionV1.ClassificationResult
      })

    const classify: Interface["classify"] = (request) =>
      Effect.suspend(() => {
        const existing = active.get(request)
        if (existing) return Deferred.await(existing)
        const deferred = Deferred.makeUnsafe<PermissionV1.ClassificationResult>()
        active.set(request, deferred)
        return run(request).pipe(
          Effect.timeoutOrElse({
            duration: "15 seconds",
            orElse: () => failed(request, "timeout"),
          }),
          Effect.catchCause(() => failed(request, "model_or_context_error")),
          Effect.tap((decision) => Deferred.succeed(deferred, decision)),
          Effect.ensuring(Deferred.succeed(deferred, { approved: false })),
        )
      })

    return Service.of({ classify })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, Provider.node, LLM.node, Session.node],
})

export * as PermissionAutoApprove from "./auto-approve"

export * as SessionCompaction from "./compaction"

import { LLM, LLMClient, LLMError, LLMEvent, Message, type LLMRequest, type Model } from "@opencode-ai/llm"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Context, Effect, Layer, Stream } from "effect"
import { Config } from "../config"
import { EventV2 } from "../event"
import { makeLocationNode } from "../effect/app-node"
import { llmClient } from "../effect/app-node-platform"
import { SessionEvent } from "./event"
import type { SessionMessage } from "./message"
import { SessionRunnerModel } from "./runner/model"
import { SessionSchema } from "./schema"
import { toSessionError } from "./to-session-error"
import { Token } from "../util/token"

const DEFAULT_BUFFER = 20_000
const DEFAULT_KEEP_TOKENS = 8_000
const OUTPUT_TOKEN_MAX = 32_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Important Details
- [constraints/preferences, decisions and why, important facts/assumptions, exact context needed to continue, or "(none)"]

## Work State
### Completed
- [finished work, verified facts, or changes made; otherwise "(none)"]

### Active
- [current work, partial changes, or investigation state; otherwise "(none)"]

### Blocked
- [blockers, failing commands, or unknowns; otherwise "(none)"]

## Next Move
1. [immediate concrete action, or "(none)"]
2. [next action if known, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.
- Do not mention the summary process or that context was compacted.`

type Settings = {
  readonly auto: boolean
  readonly buffer: number
  readonly tokens: number
}

type Dependencies = {
  readonly events: EventV2.Interface
  readonly llm: {
    readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>
  }
  readonly models: SessionRunnerModel.Interface
  readonly config: Settings
}

export type AutoInput = {
  readonly sessionID: SessionSchema.ID
  readonly messages: readonly SessionMessage.Info[]
  readonly model: Model
}

export type ManualInput = {
  readonly session: SessionSchema.Info
  readonly messages: readonly SessionMessage.Info[]
  readonly inputID: SessionMessage.ID
}

type Plan = {
  readonly sessionID: SessionSchema.ID
  readonly model: Model
  readonly reason: SessionMessage.Compaction["reason"]
  readonly prompt: string
  readonly recent: string
  readonly inputID?: SessionMessage.ID
}

export type Outcome =
  | Pick<SessionMessage.CompactionCompleted, "status">
  | Pick<SessionMessage.CompactionFailed, "status" | "error">

export interface Interface {
  readonly required: (input: AutoInput) => boolean
  readonly compact: (input: AutoInput) => Effect.Effect<Outcome>
  readonly compactManual: (input: ManualInput) => Effect.Effect<Outcome>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionCompaction") {}

const truncate = (value: string) =>
  value.length <= TOOL_OUTPUT_MAX_CHARS ? value : `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`

export const serializeToolContent = (content: SessionMessage.ToolStateCompleted["content"]) =>
  content
    .map((item) =>
      item.type === "text" ? item.text : `[Attached ${item.mime}${item.name === undefined ? "" : `: ${item.name}`}]`,
    )
    .join("\n")

const serialize = (message: SessionMessage.Info) => {
  if (message.type === "user") {
    const files =
      message.files?.map(
        (file) =>
          `[Attached ${file.mime}: ${file.name ?? (file.source.type === "uri" ? file.source.uri : "inline attachment")}]`,
      ) ?? []
    return [`[User]: ${message.text}`, ...files].join("\n")
  }
  if (message.type === "assistant") {
    return message.content
      .flatMap((part) => {
        if (part.type === "text") return [`[Assistant]: ${part.text}`]
        if (part.type === "reasoning") return part.text ? [`[Assistant reasoning]: ${part.text}`] : []
        const input = typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input)
        if (part.state.status === "completed")
          return [
            `[Assistant tool call]: ${part.name}(${input})`,
            `[Tool result]: ${truncate(serializeToolContent(part.state.content))}`,
          ]
        if (part.state.status === "error")
          return [`[Assistant tool call]: ${part.name}(${input})`, `[Tool error]: ${part.state.error.message}`]
        return [`[Assistant tool call]: ${part.name}(${input})`]
      })
      .join("\n")
  }
  if (message.type === "system") return `[System update]: ${message.text}`
  if (message.type === "synthetic") return `[Synthetic context]: ${message.text}`
  if (message.type === "skill") return `[Skill activated: ${message.name}]\n${message.text}`
  if (message.type === "shell") return `[Shell]: ${message.command}\n${truncate(message.output?.output ?? "")}`
  return ""
}

const settings = (documents: readonly Config.Entry[]) => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.compaction ? [entry.info.compaction] : []))
  return configured.reduce<Settings>(
    (result, current) => ({
      auto: current.auto ?? result.auto,
      buffer: current.buffer ?? result.buffer,
      tokens: current.keep?.tokens ?? result.tokens,
    }),
    { auto: true, buffer: DEFAULT_BUFFER, tokens: DEFAULT_KEEP_TOKENS },
  )
}

const select = (
  messages: readonly SessionMessage.Info[],
  tokens: number,
): { readonly head: string; readonly recent: string } | undefined => {
  const conversation = messages
    .filter((message) => message.type !== "compaction" && message.type !== "system")
    .flatMap((message) => {
      const text = serialize(message)
      return text ? [{ message, text }] : []
    })
  if (conversation.length === 0) return undefined
  let total = 0
  let split = conversation.length
  for (let index = conversation.length - 1; index >= 0; index--) {
    const next = total + Token.estimate(conversation[index].text)
    if (split < conversation.length && next > tokens) break
    total = next
    split = index
  }
  while (split > 0 && conversation[split].message.type !== "user") split--
  if (split === 0) {
    const latestUser = conversation.findLastIndex((item) => item.message.type === "user")
    if (latestUser > 0) split = latestUser
  }
  return {
    head: conversation
      .slice(0, split)
      .map((item) => item.text)
      .join("\n\n"),
    recent: conversation
      .slice(split)
      .map((item) => item.text)
      .join("\n\n"),
  }
}

export const buildPrompt = (input: { readonly previousSummary?: string; readonly context: readonly string[] }) =>
  [
    input.previousSummary
      ? `Update the anchored summary below using the conversation history above.\nPreserve still-true details, remove stale details, and merge in the new facts.\n<previous-summary>\n${input.previousSummary}\n</previous-summary>`
      : "Create a new anchored summary from the conversation history.",
    SUMMARY_TEMPLATE,
    ...input.context,
  ].join("\n\n")

const planContent = (messages: readonly SessionMessage.Info[], tokens: number) => {
  const selected = select(messages, tokens)
  if (!selected) return
  const previousSummary = messages.findLast(
    (message) => message.type === "compaction" && message.status === "completed",
  )
  const previousRecent = previousSummary?.type === "compaction" ? previousSummary.recent : ""
  const summarizeRecent = !previousRecent && !selected.head
  return {
    prompt: buildPrompt({
      previousSummary: previousSummary?.type === "compaction" ? previousSummary.summary : undefined,
      context: summarizeRecent ? [selected.recent] : [previousRecent, selected.head].filter(Boolean),
    }),
    recent: summarizeRecent ? "" : selected.recent,
  }
}

const make = (dependencies: Dependencies) => {
  const config = dependencies.config
  const failed = Effect.fnUntraced(function* (input: {
    readonly sessionID: SessionSchema.ID
    readonly reason: SessionMessage.Compaction["reason"]
    readonly error: SessionError.Error
    readonly inputID?: SessionMessage.ID
  }) {
    yield* dependencies.events.publish(SessionEvent.Compaction.Failed, input)
    return { status: "failed" as const, error: input.error }
  })
  const execute = Effect.fn("SessionCompaction.execute")(function* (plan: Plan) {
    yield* dependencies.events.publish(SessionEvent.Compaction.Started, {
      sessionID: plan.sessionID,
      reason: plan.reason,
      recent: plan.recent,
      inputID: plan.inputID,
    })

    const chunks: string[] = []
    let failure: SessionError.Error | undefined
    yield* dependencies.llm
      .stream(
        LLM.request({
          model: plan.model,
          messages: [Message.user(plan.prompt)],
          tools: [],
        }),
      )
      .pipe(
        Stream.runForEach((event) => {
          if (LLMEvent.is.providerError(event))
            failure = {
              type: event.classification === "context-overflow" ? "provider.invalid-request" : "provider.error",
              message: event.message,
            }
          if (LLMEvent.is.textDelta(event)) {
            chunks.push(event.text)
            return dependencies.events.publish(SessionEvent.Compaction.Delta, {
              sessionID: plan.sessionID,
              text: event.text,
            })
          }
          return Effect.void
        }),
        Effect.catchTag("LLM.Error", (error) =>
          Effect.sync(() => {
            failure = toSessionError(error)
          }),
        ),
        Effect.onInterrupt(() =>
          plan.reason === "auto"
            ? failed({
                sessionID: plan.sessionID,
                reason: plan.reason,
                error: { type: "compaction.interrupted", message: "Compaction was interrupted" },
                inputID: plan.inputID,
              }).pipe(Effect.asVoid)
            : Effect.void,
        ),
      )
    const summary = chunks.join("")
    if (failure || !summary.trim()) {
      const error = failure ?? { type: "compaction.failed" as const, message: "Compaction produced no summary" }
      return yield* failed({
        sessionID: plan.sessionID,
        reason: plan.reason,
        error,
        inputID: plan.inputID,
      })
    }
    yield* dependencies.events.publish(SessionEvent.Compaction.Ended, {
      sessionID: plan.sessionID,
      reason: plan.reason,
      text: summary,
      recent: plan.recent,
    })
    return { status: "completed" as const }
  })
  const compact = Effect.fn("SessionCompaction.compact")(function* (input: AutoInput) {
    const content = planContent(input.messages, config.tokens)
    if (content)
      return yield* execute({
        sessionID: input.sessionID,
        model: input.model,
        reason: "auto",
        ...content,
      })
    const error = { type: "compaction.unavailable" as const, message: "Nothing to compact yet" }
    return yield* failed({
      sessionID: input.sessionID,
      reason: "auto",
      error,
    })
  })
  const required = (input: AutoInput) => {
    if (!config.auto) return false
    const context = input.model.route.defaults.limits?.context
    if (context === undefined || context <= 0) return false
    const last = input.messages.findLast(
      (message): message is SessionMessage.Assistant & { tokens: NonNullable<SessionMessage.Assistant["tokens"]> } =>
        message.type === "assistant" && message.tokens !== undefined,
    )
    if (!last) return false
    const output = Math.min(input.model.route.defaults.limits?.output ?? 0, OUTPUT_TOKEN_MAX)
    const used =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (used <= 0) return false
    return used >= context - (output || config.buffer)
  }
  const compactManual = Effect.fn("SessionCompaction.compactManual")(function* (input: ManualInput) {
    const content = planContent(input.messages, config.tokens)
    if (!content)
      return yield* failed({
        sessionID: input.session.id,
        reason: "manual",
        error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
        inputID: input.inputID,
      })
    const resolved = yield* dependencies.models.resolve(input.session).pipe(
      Effect.catch((cause) =>
        failed({
          sessionID: input.session.id,
          reason: "manual",
          error: toSessionError(cause),
          inputID: input.inputID,
        }),
      ),
    )
    if ("status" in resolved) return resolved
    return yield* execute({
      sessionID: input.session.id,
      model: resolved.model,
      reason: "manual",
      inputID: input.inputID,
      ...content,
    })
  })
  return Service.of({
    required,
    compact,
    compactManual,
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const llm = yield* LLMClient.Service
    const config = yield* Config.Service
    const models = yield* SessionRunnerModel.Service
    return make({ events, llm, models, config: settings(yield* config.entries()) })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [EventV2.node, llmClient, Config.node, SessionRunnerModel.node],
})

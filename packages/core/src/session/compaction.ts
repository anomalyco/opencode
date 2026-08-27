export * as SessionCompaction from "./compaction.js"

import { LLMClient, AIError, LLMEvent, Message, type LLMRequest } from "@opencode-ai/ai"
import type { StreamOptions } from "@opencode-ai/ai/route"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Context, Effect, Layer, Stream } from "effect"
import { Bus } from "../bus.js"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { llmClient } from "../effect/app-node-platform.js"
import { SessionEvent } from "./event.js"
import type { SessionMessage } from "./message.js"
import { SessionModelRequest } from "./model-request.js"
import { SessionRunnerModel } from "./runner/model.js"
import { SessionSchema } from "./schema.js"
import { toSessionError } from "./to-session-error.js"
import { Token } from "../util/token.js"
import { SessionUsage } from "./usage.js"
import { Agent } from "../agent.js"
import { State } from "../state.js"

const DEFAULT_BUFFER = 20_000
const DEFAULT_KEEP_TOKENS = 15_000
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

export type Settings = {
  auto: boolean
  buffer: number
  tokens: number
}

export type Draft = {
  configure: (settings: Partial<Settings>) => void
}

type Dependencies = {
  readonly bus: Bus.Interface
  readonly llm: {
    readonly stream: (request: LLMRequest, options?: StreamOptions) => Stream.Stream<LLMEvent, AIError>
  }
  readonly models: SessionRunnerModel.Interface
  readonly modelRequests: SessionModelRequest.Interface
}

export type AutoInput = {
  readonly session: SessionSchema.Info
  readonly messages: readonly SessionMessage.Info[]
  readonly resolved: SessionRunnerModel.Resolved
}

type RequiredInput = Pick<AutoInput, "messages" | "resolved">

export type ManualInput = {
  readonly session: SessionSchema.Info
  readonly messages: readonly SessionMessage.Info[]
  readonly inputID: SessionMessage.ID
  readonly started?: boolean
}

type Plan = {
  readonly session: SessionSchema.Info
  readonly resolved: SessionRunnerModel.Resolved
  readonly reason: SessionMessage.Compaction["reason"]
  readonly prompt: string
  readonly recent: string
  readonly inputID?: SessionMessage.ID
  readonly started?: boolean
}

export type Outcome =
  | Pick<SessionMessage.CompactionCompleted, "status">
  | Pick<SessionMessage.CompactionFailed, "status" | "error">

export interface Interface extends State.Transformable<Draft> {
  readonly enabled: () => boolean
  readonly required: (input: RequiredInput) => boolean
  readonly compact: (input: AutoInput) => Effect.Effect<Outcome>
  readonly compactManual: (input: ManualInput) => Effect.Effect<Outcome>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

export const truncateToolOutput = (value: string) => {
  if (value.length <= TOOL_OUTPUT_MAX_CHARS) return value
  let end = 0
  for (let count = 0; count < TOOL_OUTPUT_MAX_CHARS && end < value.length; count++) {
    const code = value.charCodeAt(end)
    end +=
      code >= 0xd800 && code <= 0xdbff && value.charCodeAt(end + 1) >= 0xdc00 && value.charCodeAt(end + 1) <= 0xdfff
        ? 2
        : 1
  }
  if (end === value.length) return value
  return `${value.slice(0, end)}\n[truncated]`
}

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
    const skills =
      message.skills?.flatMap((skill) =>
        skill.text === undefined ? [] : [`[Skill activated: ${skill.name}]\n${skill.text}`],
      ) ?? []
    return [...skills, `[User]: ${message.text}`, ...files].join("\n")
  }
  if (message.type === "location-switched")
    return `[User]: The working directory has been changed to ${message.location.directory}.`
  if (message.type === "assistant") {
    return message.content
      .flatMap((part) => {
        if (part.type === "text") return [`[Assistant]: ${part.text}`]
        if (part.type === "reasoning") return part.text ? [`[Assistant reasoning]: ${part.text}`] : []
        const input = typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input)
        if (part.state.status === "completed")
          return [
            `[Assistant tool call]: ${part.name}(${input})`,
            `[Tool result]: ${truncateToolOutput(serializeToolContent(part.state.content))}`,
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
  if (message.type === "shell")
    return `[Shell]: ${message.command}\n${truncateToolOutput(message.output?.output ?? "")}`
  return ""
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
    "The following is the conversation history:",
    ...input.context,
  ].join("\n\n")

const planContent = (messages: readonly SessionMessage.Info[], tokens: number) => {
  const selected = select(messages, tokens)
  if (!selected) return
  const previousSummary = messages.findLast(
    (message): message is SessionMessage.CompactionCompleted =>
      message.type === "compaction" && message.status === "completed",
  )
  const previousRecent = previousSummary?.recent ?? ""
  const summarizeRecent = !previousRecent && !selected.head
  return {
    prompt: buildPrompt({
      previousSummary: previousSummary?.summary,
      context: summarizeRecent ? [selected.recent] : [previousRecent, selected.head].filter(Boolean),
    }),
    recent: summarizeRecent ? "" : selected.recent,
  }
}

const make = (dependencies: Dependencies) => {
  const state = State.create<Settings, Draft>({
    name: "session-compaction",
    initial: () => ({ auto: true, buffer: DEFAULT_BUFFER, tokens: DEFAULT_KEEP_TOKENS }),
    draft: (draft) => ({
      configure: (settings) => {
        if (settings.auto !== undefined) draft.auto = settings.auto
        if (settings.buffer !== undefined) draft.buffer = settings.buffer
        if (settings.tokens !== undefined) draft.tokens = settings.tokens
      },
    }),
  })
  const failed = Effect.fnUntraced(function* (input: {
    readonly sessionID: SessionSchema.ID
    readonly reason: SessionMessage.Compaction["reason"]
    readonly error: SessionError.Error
    readonly inputID?: SessionMessage.ID
  }) {
    yield* dependencies.bus.publish(SessionEvent.Compaction.Failed, input)
    return { status: "failed" as const, error: input.error }
  })
  const execute = Effect.fn("SessionCompaction.execute")(function* (plan: Plan) {
    if (!plan.started)
      yield* dependencies.bus.publish(SessionEvent.Compaction.Started, {
        sessionID: plan.session.id,
        reason: plan.reason,
        recent: plan.recent,
        inputID: plan.inputID,
      })

    const chunks: string[] = []
    let failure: SessionError.Error | undefined
    let usage: SessionUsage.Recorded | undefined
    const recordUsage = Effect.suspend(() =>
      usage
        ? dependencies.bus.publish(SessionEvent.UsageRecorded, {
            sessionID: plan.session.id,
            source: "compaction",
            ...usage,
          })
        : Effect.void,
    )
    const prepared = yield* dependencies.modelRequests.prepare({
      scope: { session: plan.session, agentID: Agent.ID.make("compaction"), model: plan.resolved },
      transcript: { system: [], messages: [Message.user(plan.prompt)] },
      contextHooks: false,
    })
    yield* dependencies.llm.stream(prepared.request, prepared.options).pipe(
      Stream.runForEach((event) => {
        if (LLMEvent.is.providerError(event))
          failure = {
            type: event.classification === "context-overflow" ? "provider.invalid-request" : "provider.error",
            message: event.message,
          }
        if (LLMEvent.is.textDelta(event)) {
          chunks.push(event.text)
          return dependencies.bus.publish(SessionEvent.Compaction.Delta, {
            sessionID: plan.session.id,
            text: event.text,
          })
        }
        if (LLMEvent.is.stepFinish(event)) {
          const step = SessionUsage.record(event.usage, plan.resolved.cost)
          usage = usage ? SessionUsage.add(usage, step) : step
        }
        return Effect.void
      }),
      Effect.catchTag("AI.Error", (error) =>
        Effect.sync(() => {
          failure = toSessionError(error)
        }),
      ),
      Effect.onInterrupt(() =>
        recordUsage.pipe(
          Effect.andThen(
            plan.reason === "auto"
              ? failed({
                  sessionID: plan.session.id,
                  reason: plan.reason,
                  error: { type: "compaction.interrupted", message: "Compaction was interrupted" },
                  inputID: plan.inputID,
                }).pipe(Effect.asVoid)
              : Effect.void,
          ),
        ),
      ),
    )
    yield* recordUsage
    const summary = chunks.join("")
    if (failure || !summary.trim()) {
      const error = failure ?? { type: "compaction.failed" as const, message: "Compaction produced no summary" }
      return yield* failed({
        sessionID: plan.session.id,
        reason: plan.reason,
        error,
        inputID: plan.inputID,
      })
    }
    yield* dependencies.bus.publish(SessionEvent.Compaction.Ended, {
      sessionID: plan.session.id,
      reason: plan.reason,
      text: summary,
      recent: plan.recent,
    })
    return { status: "completed" as const }
  })
  const compact = Effect.fn("SessionCompaction.compact")(function* (input: AutoInput) {
    const content = planContent(input.messages, state.get().tokens)
    if (content)
      return yield* execute({
        session: input.session,
        resolved: input.resolved,
        reason: "auto",
        ...content,
      })
    return yield* failed({
      sessionID: input.session.id,
      reason: "auto",
      error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
    })
  })
  const required = (input: RequiredInput) => {
    const config = state.get()
    if (!config.auto) return false
    const limit = input.resolved.limit
    const context = limit.context
    if (context <= 0) return false
    const last = input.messages.findLast(
      (message): message is SessionMessage.Assistant & { tokens: NonNullable<SessionMessage.Assistant["tokens"]> } =>
        message.type === "assistant" && message.tokens !== undefined,
    )
    if (!last) return false
    const output = Math.min(limit.output, OUTPUT_TOKEN_MAX)
    const promptCeiling = Math.min(
      limit.input === undefined ? Number.POSITIVE_INFINITY : limit.input - config.buffer,
      context - Math.max(output, config.buffer),
    )
    const used =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (used <= 0) return false
    return used >= promptCeiling
  }
  const compactManual = Effect.fn("SessionCompaction.compactManual")(function* (input: ManualInput) {
    const content = planContent(input.messages, state.get().tokens)
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
      session: input.session,
      resolved,
      reason: "manual",
      inputID: input.inputID,
      started: input.started,
      ...content,
    })
  })
  return Service.of({
    transform: state.transform,
    reload: state.reload,
    enabled: () => state.get().auto,
    required,
    compact,
    compactManual,
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const llm = yield* LLMClient.Service
    const models = yield* SessionRunnerModel.Service
    const modelRequests = yield* SessionModelRequest.Service
    return make({ bus, llm, models, modelRequests })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, llmClient, SessionRunnerModel.node, SessionModelRequest.node],
})

export * as SessionCompaction from "./compaction.js"

import {
  AIError,
  InvalidProviderOutputError,
  UnknownProviderError,
  isContextOverflowFailure,
  LLMClient,
  LLMEvent,
  LLMRequest,
  Message,
  type ContentPart,
} from "@opencode-ai/ai"
import { Agent } from "@opencode-ai/schema/agent"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Context, Effect, Layer, Stream } from "effect"
import { Bus } from "../bus.js"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { llmClient } from "../effect/app-node-platform.js"
import { SessionEvent } from "./event.js"
import type { SessionContext } from "./context.js"
import type { SessionMessage } from "./message.js"
import { SessionModelRequest } from "./model-request.js"
import type { SessionRunnerModel } from "./runner/model.js"
import { SessionRunnerRetry } from "./runner/retry.js"
import { SessionSchema } from "./schema.js"
import { toSessionError } from "./to-session-error.js"
import { Token } from "../util/token.js"
import { SessionUsage } from "./usage.js"
import { State } from "../state.js"
import { toLLMMessages } from "./runner/to-llm-message.js"
import type { AgentNotFoundError } from "./error.js"
import type { Instructions } from "../instructions/index.js"

const DEFAULT_BUFFER = 20_000
const DEFAULT_KEEP_TOKENS = 15_000
const OUTPUT_TOKEN_MAX = 32_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const IMAGE_TOKEN_ESTIMATE = 1_500
const PDF_TOKEN_ESTIMATE = 2_000
const SUMMARY_TEMPLATE = `You MUST use this format for your response (you may omit sections that aren't applicable). Do not include the <template> tags in your response.
<template>
## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Requirements
- [constraints, preferences, requirements, and scope boundaries, or "(none)"]

## Decisions
- [decisions already made and why, or "(none)"]

## Work State
### Completed
- [finished work, verified facts, or changes made; otherwise "(none)"]

### Active
- [current work, partial changes, or investigation state; otherwise "(none)"]

### Blocked
- [blockers, failing commands, or unknowns; otherwise "(none)"]

## Next Move
1. [ordered list of next actions, or "(none)"]

## Relevant Files
List files and directories that are important to the conversation. Include paths outside the current working directory when relevant. If none are relevant, write "(none)".
- \`[exact path]\`: [why it matters]

## Additional Context
- [facts or references needed to continue the work that are not captured above; omit this section if none]
</template>`

const SUMMARY_RULES = `Rules:
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.
- Carry forward only user questions or requests that remain unanswered or require further action. Do not repeat ones that newer history has answered or resolved. Preserve exact wording when carrying one forward.
- Preserve consequential workflow state, including whether changes are uncommitted, committed, pushed, under review, or merged.
- Do not include ambient environment metadata such as the session ID, current working directory, repository root, current branch, or worktree path. The next agent receives current environment information separately. Include these details only when they directly affect the task.
- Do not mention the summary process or that context was compacted.`

const SUMMARY_HEADINGS = SUMMARY_TEMPLATE.split("\n").filter((line) => line.startsWith("##"))

export type Settings = {
  auto: boolean
  buffer: number
  tokens: number
}

export type Editor = {
  configure: (settings: Partial<Settings>) => void
}

export type AutoInput = {
  readonly context: SessionContext.Loaded
  readonly prepare: SessionModelRequest.Interface["prepare"]
}

type RequiredInput = {
  readonly messages: readonly SessionMessage.Info[]
  readonly resolved: SessionRunnerModel.Resolved
  readonly context: SessionContext.Loaded
}

export type ManualInput = {
  readonly session: SessionSchema.Info
  readonly messages: readonly SessionMessage.Info[]
  readonly inputID: SessionMessage.ID
  readonly started?: boolean
  /** Empty compaction controls do not preflight model or instruction availability. */
  readonly resolveContext: (
    session: SessionSchema.Info,
  ) => Effect.Effect<
    SessionContext.Loaded & { readonly instructionUpdate: string },
    SessionRunnerModel.Error | AgentNotFoundError | Instructions.InitializationBlocked
  >
  readonly prepare: SessionModelRequest.Interface["prepare"]
}

type ExecuteInput = AutoInput & {
  readonly reason: SessionMessage.Compaction["reason"]
  readonly inputID?: SessionMessage.ID
  readonly started?: boolean
  readonly instructionUpdate?: string
}

export type Outcome =
  | Pick<SessionMessage.CompactionCompleted, "status">
  | Pick<SessionMessage.CompactionFailed, "status" | "error">

export interface Interface extends State.Transformable<Editor> {
  readonly enabled: () => boolean
  readonly required: (input: RequiredInput) => boolean
  readonly compact: (input: AutoInput) => Effect.Effect<Outcome>
  readonly compactManual: (input: ManualInput) => Effect.Effect<Outcome>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

export const estimateTokens = (input: RequiredInput) => {
  const index = input.messages.findLastIndex(
    (message) =>
      message.type === "assistant" &&
      !message.error &&
      message.tokens !== undefined &&
      message.tokens.input + message.tokens.cache.read + message.tokens.cache.write > 0,
  )
  const last = input.messages[index]
  // Keep the anchor's local tool results: they are not covered by its provider usage.
  const added = SessionModelRequest.unsupportedParts(
    toLLMMessages(input.messages.slice(Math.max(0, index)), input.resolved.ref),
    input.resolved.capabilities,
  )
    .filter((message) => message.role !== "assistant" || message.id !== last?.id)
    .reduce((sum, message) => sum + message.content.reduce((sum, part) => sum + estimatePart(part), 0), 0)
  if (last?.type === "assistant" && last.tokens)
    return (
      added +
      last.tokens.input +
      last.tokens.cache.read +
      last.tokens.cache.write +
      last.tokens.output +
      last.tokens.reasoning
    )
  const transcript = SessionModelRequest.baseTranscript({
    agent: input.context.agent.info,
    model: input.resolved,
    tools: input.context.tools,
    initial: input.context.initial,
    messages: [],
  })
  return (
    added +
    transcript.system.reduce((sum, part) => sum + Token.estimate(part.text), 0) +
    input.context.tools.definitions.reduce(
      (sum, tool) => sum + Token.estimate(tool.name + tool.description + JSON.stringify(tool.inputSchema)),
      0,
    )
  )
}

const estimateMedia = (mime: string) => {
  const type = mime.toLowerCase()
  return type.startsWith("image/") ? IMAGE_TOKEN_ESTIMATE : type === "application/pdf" ? PDF_TOKEN_ESTIMATE : 0
}

const estimatePart = (part: ContentPart): number => {
  // Encrypted checkpoints have no locally measurable token size.
  if (part.type === "compaction") return Token.estimate(part.text ?? "")
  if (part.type === "text" || part.type === "reasoning") return Token.estimate(part.text)
  if (part.type === "media") return estimateMedia(part.mediaType)
  if (part.type === "tool-call") return Token.estimate(part.name + (JSON.stringify(part.input) ?? ""))
  if (part.result.type === "content")
    return part.result.value.reduce(
      (sum, content) => sum + (content.type === "text" ? Token.estimate(content.text) : estimateMedia(content.mime)),
      0,
    )
  return Token.estimate(
    typeof part.result.value === "string" ? part.result.value : (JSON.stringify(part.result.value) ?? ""),
  )
}

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

const serializeRecentMessage = (message: SessionMessage.Info) => {
  // Checkpoints and instruction updates are handled outside the serialized tail.
  if (message.type === "compaction" || message.type === "system") return ""
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
  if (message.type === "synthetic") return `[Synthetic context]: ${message.text}`
  if (message.type === "skill") return `[Skill activated: ${message.name}]\n${message.text}`
  if (message.type === "shell")
    return message.metadata?.background === true
      ? ""
      : `[Shell]: ${message.command}\n${truncateToolOutput(message.output?.output ?? "")}`
  return ""
}

const splitHistory = (messages: readonly SessionMessage.Info[], keepTokens: number) => {
  const tailStart = findTailStart(messages, keepTokens)
  if (tailStart === undefined) return
  return {
    messages: messages.slice(0, tailStart),
    recent: messages.slice(tailStart).map(serializeRecentMessage).filter(Boolean).join("\n\n"),
  }
}

const findTailStart = (messages: readonly SessionMessage.Info[], keepTokens: number) => {
  const conversation = messages.flatMap((message, index) => {
    const text = serializeRecentMessage(message)
    return text ? [{ message, text, index }] : []
  })
  if (conversation.length === 0) return undefined

  // Keep at least the newest entry, even if it exceeds the allowance.
  let total = 0
  let start = conversation.length
  for (let index = conversation.length - 1; index >= 0; index--) {
    const next = total + Token.estimate(conversation[index].text)
    if (start < conversation.length && next > keepTokens) break
    total = next
    start = index
  }

  // Start at a user boundary so an assistant's tool calls and results stay together.
  while (start > 0 && conversation[start].message.type !== "user") start--
  if (start > 0) return conversation[start].index

  // If everything fits, retain only the latest exchange to leave an older prefix to summarize.
  const latestUser = conversation.findLastIndex((item) => item.message.type === "user")
  if (latestUser > 0) return conversation[latestUser].index

  const previousSummary = messages.findLast(
    (message): message is SessionMessage.CompactionCompleted =>
      message.type === "compaction" && message.status === "completed",
  )
  // Without an older retained tail to summarize, summarize everything and retain nothing.
  return previousSummary?.recent ? conversation[0].index : messages.length
}

export const buildPrompt = (update: boolean) => {
  const shared = [
    "Summarize only the history shown. More recent context may be retained and presented after this summary.",
    SUMMARY_TEMPLATE,
    SUMMARY_RULES,
    "Do not continue the task or call tools.",
    "Return only the structured summary in the requested format. Do not include a preamble, explanation, or other commentary.",
  ]
  if (update) {
    return [
      "Update the existing checkpoint in the conversation above into one consolidated summary.",
      "Newer history always takes precedence over the existing checkpoint. Preserve previous information unless newer history clearly contradicts, supersedes, resolves, or makes it stale. When uncertain and there is no conflict, retain it under Additional Context.",
      "Incorporate newer requirements, decisions, progress, and context. Reconcile Work State and Next Move: move completed work out of Active, remove resolved blockers and answered questions, and preserve unresolved or pending work.",
      "Return only the updated Markdown sections. Do not reproduce the `<conversation-checkpoint>`, `<summary>`, or `<recent-context>` wrapper tags from the previous checkpoint.",
      ...shared,
    ].join("\n\n")
  }
  return [
    "You MUST summarize the conversation above into a structured summary that will be given to another agent to resume the work.",
    ...shared,
  ].join("\n\n")
}

const hasSummarySection = (summary: string) =>
  summary.split("\n").some((line) => SUMMARY_HEADINGS.includes(line.trim()))

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const llm = yield* LLMClient.Service

    const state = State.create<Settings, Editor>({
      name: "session-compaction",
      initial: () => ({ auto: true, buffer: DEFAULT_BUFFER, tokens: DEFAULT_KEEP_TOKENS }),
      editor: (editor) => ({
        configure: (settings) => {
          if (settings.auto !== undefined) editor.auto = settings.auto
          if (settings.buffer !== undefined) editor.buffer = settings.buffer
          if (settings.tokens !== undefined) editor.tokens = settings.tokens
        },
      }),
    })
    const failed = Effect.fnUntraced(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly reason: SessionMessage.Compaction["reason"]
      readonly error: SessionError.Error
      readonly inputID?: SessionMessage.ID
    }) {
      yield* bus.publish(SessionEvent.Compaction.Failed, input)
      return { status: "failed" as const, error: input.error }
    })
    const execute = Effect.fn("SessionCompaction.execute")(function* (input: ExecuteInput) {
      const context = input.context
      const history = splitHistory(context.messages, state.get().tokens)
      if (!history)
        return yield* failed({
          sessionID: context.session.id,
          reason: input.reason,
          error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
          inputID: input.inputID,
        })
      if (!input.started)
        yield* bus.publish(SessionEvent.Compaction.Started, {
          sessionID: context.session.id,
          reason: input.reason,
          recent: history.recent,
          inputID: input.inputID,
        })

      const chunks: string[] = []
      let failure: SessionError.Error | undefined
      let usage: SessionUsage.Recorded | undefined
      let providerState: SessionMessage.ProviderState | undefined
      const recordUsage = Effect.suspend(() =>
        usage
          ? bus.publish(SessionEvent.UsageRecorded, {
              sessionID: context.session.id,
              source: "compaction",
              ...usage,
            })
          : Effect.void,
      )
      const transcript = SessionModelRequest.baseTranscript({
        agent: context.agent.info,
        model: context.model,
        tools: context.tools,
        initial: context.initial,
        messages: history.messages,
      })
      const prepared = yield* input.prepare({
        scope: {
          session: context.session,
          agentID: Agent.ID.make("compaction"),
          contextAgentID: context.agent.id,
          model: context.model,
          tools: context.tools,
        },
        transcript: {
          system: transcript.system,
          messages: [
            ...transcript.messages,
            ...(input.instructionUpdate ? [Message.system(input.instructionUpdate)] : []),
            Message.user(
              buildPrompt(
                history.messages.some((message) => message.type === "compaction" && message.status === "completed"),
              ),
            ),
          ],
        },
      })
      const retry = yield* SessionRunnerRetry.policy(context.session.id)
      // Both requests share the retry allowance; rejected output never enters the reminder request.
      for (const request of [
        prepared.request,
        LLMRequest.update(prepared.request, {
          messages: [
            ...prepared.request.messages,
            Message.user(
              "The previous response did not fill in the required summary template. Do not call tools. Return the summary as text using the exact section headings from the template.",
            ),
          ],
        }),
      ]) {
        yield* Stream.suspend(() => {
          chunks.length = 0
          providerState = undefined
          failure = undefined
          return llm.stream(request, prepared.options)
        }).pipe(
          Stream.runForEach((event) => {
            if (LLMEvent.is.providerError(event))
              failure = {
                type: event.classification === "context-overflow" ? "provider.invalid-request" : "provider.error",
                message: event.message,
              }
            if (LLMEvent.is.textDelta(event)) {
              chunks.push(event.text)
              return bus.publish(SessionEvent.Compaction.Delta, {
                sessionID: context.session.id,
                text: event.text,
              })
            }
            if (LLMEvent.is.stepFinish(event)) {
              providerState =
                event.providerMetadata?.[context.model.model.route.providerMetadataKey ?? context.model.model.provider]
              const step = SessionUsage.record(event.usage, context.model.cost)
              usage = usage ? SessionUsage.add(usage, step) : step
            }
            if (LLMEvent.is.finish(event)) {
              if (event.reason.normalized === "length")
                failure = { type: "compaction.failed", message: "Compaction summary reached the output token limit" }
              if (event.reason.normalized === "content-filter")
                failure = {
                  type: "provider.content-filter",
                  message: "Compaction summary was blocked by the provider",
                }
              if (event.reason.normalized === "unknown")
                return Effect.fail(
                  new AIError({
                    reason: new InvalidProviderOutputError({
                      message: "The provider response ended with an unknown finish reason.",
                      classification: "incomplete-stream",
                    }),
                  }),
                )
              if (event.reason.normalized === "error")
                return Effect.fail(
                  new AIError({ reason: new UnknownProviderError({ message: "Compaction generation failed" }) }),
                )
            }
            return Effect.void
          }),
          Effect.retry({
            while: (cause) =>
              Effect.gen(function* () {
                if (isContextOverflowFailure(cause)) return false
                const decision = yield* retry({
                  cause,
                  error: toSessionError(cause),
                  agent: Agent.ID.make("compaction"),
                  model: context.model.ref,
                  hook: prepared.retry,
                  retry: SessionRunnerRetry.isRetryable(cause),
                })
                if (!decision.retry) return false
                yield* Effect.sleep(decision.delay)
                return true
              }),
          }),
          Effect.catchTag("AI.Error", (error) =>
            Effect.sync(() => {
              failure = toSessionError(error)
            }),
          ),
          Effect.onInterrupt(() =>
            recordUsage.pipe(
              Effect.andThen(
                input.reason === "auto"
                  ? failed({
                      sessionID: context.session.id,
                      reason: input.reason,
                      error: { type: "compaction.interrupted", message: "Compaction was interrupted" },
                      inputID: input.inputID,
                    }).pipe(Effect.asVoid)
                  : Effect.void,
              ),
            ),
          ),
        )
        if (failure || hasSummarySection(chunks.join(""))) break
      }
      yield* recordUsage
      const summary = chunks.join("")
      if (failure || !hasSummarySection(summary)) {
        const error = failure ?? {
          type: "compaction.failed" as const,
          message: summary.trim()
            ? "Compaction summary did not match the required template"
            : "Compaction produced no summary",
        }
        return yield* failed({
          sessionID: context.session.id,
          reason: input.reason,
          error,
          inputID: input.inputID,
        })
      }
      yield* bus.publish(SessionEvent.Compaction.Ended, {
        sessionID: context.session.id,
        reason: input.reason,
        model: context.model.ref,
        providerState,
        text: summary,
        recent: history.recent,
      })
      return { status: "completed" as const }
    })
    const compact = (input: AutoInput) => execute({ ...input, reason: "auto" })
    const required = (input: RequiredInput) => {
      const config = state.get()
      if (!config.auto) return false
      // Run the completed checkpoint before considering another automatic compaction.
      const last = input.messages.at(-1)
      if (last?.type === "compaction" && last.status === "completed") return false
      const limit = input.resolved.limit
      const context = limit.context
      if (context <= 0) return false
      const output = Math.min(limit.output, OUTPUT_TOKEN_MAX)
      const promptCeiling = Math.min(
        limit.input === undefined ? Number.POSITIVE_INFINITY : limit.input - config.buffer,
        context - Math.max(output, config.buffer),
      )
      return estimateTokens(input) >= promptCeiling
    }
    const compactManual = Effect.fn("SessionCompaction.compactManual")(function* (input: ManualInput) {
      if (findTailStart(input.messages, state.get().tokens) === undefined)
        return yield* failed({
          sessionID: input.session.id,
          reason: "manual",
          error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
          inputID: input.inputID,
        })
      return yield* input.resolveContext(input.session).pipe(
        Effect.matchEffect({
          onFailure: (cause) =>
            failed({
              sessionID: input.session.id,
              reason: "manual",
              error: toSessionError(cause),
              inputID: input.inputID,
            }),
          onSuccess: (context) =>
            execute({
              context,
              instructionUpdate: context.instructionUpdate,
              prepare: input.prepare,
              reason: "manual",
              inputID: input.inputID,
              started: input.started,
            }),
        }),
      )
    })
    return Service.of({
      transform: state.transform,
      reload: state.reload,
      enabled: () => state.get().auto,
      required,
      compact,
      compactManual,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, llmClient],
})

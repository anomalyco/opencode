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
  type ToolResultPart,
  type Usage,
} from "@opencode/ai"
import type { StreamOptions } from "@opencode/ai/route"
import type { SessionCompactionResult } from "@opencode/plugin/effect/session"
import { SessionError } from "@opencode/schema/session-error"
import { Context, Effect, Layer, Ref, Stream } from "effect"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { llmClient } from "../effect/app-node-platform.js"
import { SessionEvent } from "./event.js"
import type { SessionContext } from "./context.js"
import { SessionHistory } from "./history.js"
import type { SessionMessage } from "./message.js"
import { SessionModelRequest } from "./model-request.js"
import { SessionProviderContext } from "./provider-context.js"
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
const SHRUNK_TOOL_OUTPUT_CHARS = 1_000
const MAX_SHRINK_ATTEMPTS = 3
const IMAGE_TOKEN_ESTIMATE = 1_500
const PDF_TOKEN_ESTIMATE = 2_000

export type Settings = {
  auto: boolean
  buffer: number
  tokens: number
}

export type NativeInput = {
  readonly request: LLMRequest
  readonly options: StreamOptions
  /** Whole, real user messages within the retained-token allowance, for checkpoint-only mechanisms. */
  readonly retained: Effect.Effect<ReadonlyArray<Message>>
}

export type NativeResult = {
  readonly replacement: ReadonlyArray<Message>
  readonly usage?: Usage
}

/** Returns the provider's replacement window, or `undefined` when this strategy has no mechanism for the route. */
export type NativeStrategy = (input: NativeInput) => Effect.Effect<NativeResult, AIError> | undefined

export type Editor = {
  configure: (settings: Partial<Settings>) => void
  /** Later registrations take precedence. */
  native: (strategy: NativeStrategy) => void
}

export type AutoInput = {
  readonly context: SessionContext.Loaded
  readonly prepare: SessionModelRequest.Interface["compaction"]
  /** The loaded messages were just rejected as too long. Compact from the original messages, not from them. */
  readonly overflow?: boolean
}

type RequiredInput = {
  readonly messages: readonly SessionMessage.Info[]
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
  readonly prepare: SessionModelRequest.Interface["compaction"]
}

/** One compaction to perform, however it was requested. */
type Job = AutoInput & {
  readonly reason: SessionMessage.Compaction["reason"]
  readonly inputID?: SessionMessage.ID
  readonly started?: boolean
  readonly instructionUpdate?: string
}

export type Outcome =
  | (Pick<SessionMessage.CompactionCompleted, "status"> & {
      /** Consumes the logical step's one overflow rebuild even when the native attempt overflowed first. */
      readonly recoveredOverflow?: boolean
    })
  | Pick<SessionMessage.CompactionFailed, "status" | "error">

export interface Interface extends State.Transformable<Editor> {
  readonly enabled: () => boolean
  readonly required: (input: RequiredInput) => boolean
  readonly compact: (input: AutoInput) => Effect.Effect<Outcome>
  readonly compactManual: (input: ManualInput) => Effect.Effect<Outcome>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

// Summary prompt

const SUMMARY_TEMPLATE = `You MUST use this format for your response (you may omit sections that aren't applicable). Do not include the <template> tags in your response.
<template>
## Objective
- [one or two brief sentences describing what the user is trying to accomplish]

## Requirements
- [constraints, preferences, requirements, and scope boundaries stated by the user, or "(none)"]

## Decisions
- [decisions already made and why, or "(none)"]

## Work State
Break the objective into smaller goals and report which are completed, which are being worked on, and which are blocked.
### Completed
- [goals that have been completed; otherwise "(none)"]

### Active
- [goals currently being worked on; otherwise "(none)"]

### Blocked
- [anything blocking progress, and why; otherwise "(none)"]

## Next Move
1. [ordered list of next actions, or "(none)"]

## Relevant Files
List the files and directories, other than the current working directory, that another agent would need to open to continue this work. Include at most 15, most important first. Do not list every file that was read or changed. Include paths outside the current working directory when relevant. If none, write "(none)".
- \`[file or directory path]\`: [brief reason it matters]

## Important Context
- [facts the next agent cannot continue without and cannot easily find on its own; or "(none)"]
</template>`

const SUMMARY_RULES = `Rules:
- Keep each section concise. Use terse, single-line bullets, not prose paragraphs or nested lists.
- Prefer short references over detailed restatement. It is fine to leave out information the next agent can recover from the code or the files listed above.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers.
- Carry forward only user questions or requests that remain unanswered or require further action. Do not repeat ones that newer history has answered or resolved. Preserve exact wording when carrying one forward.
- Preserve consequential workflow state, including whether changes are uncommitted, committed, pushed, under review, or merged.
- Do not mention the summary process or that context was compacted.`

export const buildPrompt = (update: boolean, legacy = false) => {
  const shared = [
    "Summarize only what the user and the assistant said and did. Leave out instructions and setup the assistant was given rather than told by the user: repository conventions, instruction files such as AGENTS.md, and environment details like the session ID. The next agent receives current versions of all of these separately.",
    SUMMARY_TEMPLATE,
    SUMMARY_RULES,
    "Do not continue the task or call tools.",
    "Return only the structured summary in the requested format. Do not include a preamble, explanation, or other commentary.",
  ]
  if (!update) {
    return [
      "You MUST summarize the conversation above into a structured summary that will be given to another agent to resume the work.",
      ...shared,
    ].join("\n\n")
  }
  return [
    "Update the existing checkpoint in the conversation above into one consolidated summary.",
    ...(legacy
      ? [
          "The existing checkpoint was written with an earlier format that recorded far more detail than this one asks for. Rewrite it at the level of detail described below rather than carrying its detail forward. Keep its requirements, decisions, and open questions; they came from earlier conversation with the user.",
        ]
      : []),
    "Newer history always takes precedence over the existing checkpoint. Preserve previous information unless newer history clearly contradicts, supersedes, resolves, or makes it stale. If something is no longer relevant to continuing the work, you may remove it.",
    "Incorporate newer requirements, decisions, progress, and context. Reconcile Work State and Next Move: move completed work out of Active, remove resolved blockers and answered questions, and preserve unresolved or pending work.",
    "Return only the updated Markdown sections. Do not reproduce the `<conversation-checkpoint>`, `<summary>`, or `<recent-context>` wrapper tags from the previous checkpoint.",
    ...shared,
  ].join("\n\n")
}

const NUDGE =
  "The previous response did not fill in the required summary template. Do not call tools. Return the summary as text using the exact section headings from the template."

/** Summaries written with the previous template carry this catch-all heading. */
const LEGACY_HEADING = "## Additional Context"

const SUMMARY_HEADINGS = SUMMARY_TEMPLATE.split("\n").filter((line) => line.startsWith("##"))

const hasSummarySection = (text: string) => text.split("\n").some((line) => SUMMARY_HEADINGS.includes(line.trim()))

// Message text

/** One message as the recent, verbatim part of a summary shows it. Empty for messages that part leaves out. */
const messageToText = (message: SessionMessage.Info): string => {
  switch (message.type) {
    // Earlier summaries and instruction updates are handled outside the recent part.
    case "compaction":
    case "system":
      return ""

    case "user": {
      const skills =
        message.skills?.flatMap((skill) =>
          skill.text === undefined ? [] : [`[Skill activated: ${skill.name}]\n${skill.text}`],
        ) ?? []
      const files =
        message.files?.map((file) => {
          const name = file.name ?? (file.source.type === "uri" ? file.source.uri : "inline attachment")
          return `[Attached ${file.mime}: ${name}]`
        }) ?? []
      return [...skills, `[User]: ${message.text}`, ...files].join("\n")
    }

    case "location-switched":
      return `[User]: The working directory has been changed to ${message.location.directory}.`

    case "assistant":
      return message.content
        .flatMap((part) => {
          if (part.type === "text") return [`[Assistant]: ${part.text}`]
          if (part.type === "reasoning") return part.text ? [`[Assistant reasoning]: ${part.text}`] : []

          const input = typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input)
          const call = `[Assistant tool call]: ${part.name}(${input})`
          if (part.state.status === "completed") {
            return [call, `[Tool result]: ${truncateToolOutput(serializeToolContent(part.state.content))}`]
          }
          if (part.state.status === "error") return [call, `[Tool error]: ${part.state.error.message}`]
          return [call]
        })
        .join("\n")

    case "synthetic":
      return `[Synthetic context]: ${message.text}`

    case "skill":
      return `[Skill activated: ${message.name}]\n${message.text}`

    case "shell":
      if (message.metadata?.background === true) return ""
      return `[Shell]: ${message.command}\n${truncateToolOutput(message.output?.output ?? "")}`

    default:
      return ""
  }
}

export const truncateToolOutput = (value: string, maxChars = TOOL_OUTPUT_MAX_CHARS) => {
  if (value.length <= maxChars) return value

  // Count code points so a surrogate pair is never split.
  let end = 0
  let kept = 0
  for (const char of value) {
    if (kept === maxChars) break
    end += char.length
    kept++
  }
  if (end === value.length) return value
  return `${value.slice(0, end)}\n[truncated]`
}

export const serializeToolContent = (content: ReadonlyArray<SessionMessage.ToolStateCompleted["content"][number]>) =>
  content
    .map((item) => {
      if (item.type === "text") return item.text
      return `[Attached ${item.mime}${item.name === undefined ? "" : `: ${item.name}`}]`
    })
    .join("\n")

const toolResultText = (result: ToolResultPart["result"]) => {
  if (result.type === "content") return serializeToolContent(result.value)
  if (typeof result.value === "string") return result.value
  return JSON.stringify(result.value) ?? ""
}

// Prompt size

/** The request the runner would send for these messages: system prompt, instructions, and conversation. */
const baseRequest = (context: SessionContext.Loaded, messages: readonly SessionMessage.Info[]) =>
  SessionModelRequest.baseTranscript({
    agent: context.agent.info,
    model: context.model,
    tools: context.tools,
    initial: context.initial,
    messages,
  })

/** How many tokens the prompt built from these messages would take. */
export const estimateTokens = (input: RequiredInput) => {
  const model = input.context.model
  const anchorIndex = input.messages.findLastIndex(hasMeasuredPrompt)
  const anchor = input.messages[anchorIndex]

  // The anchor's usage measured everything up to and including its own output. Everything after it is
  // estimated, and so are the anchor's local tool results, which the provider never saw.
  const unmeasured = SessionModelRequest.unsupportedParts(
    toLLMMessages(input.messages.slice(Math.max(0, anchorIndex)), model.ref),
    model.capabilities,
  ).filter((message) => message.role !== "assistant" || message.id !== anchor?.id)
  const estimated = unmeasured.reduce((sum, message) => sum + estimateMessage(message), 0)

  if (anchor?.type === "assistant" && anchor.tokens) {
    const tokens = anchor.tokens
    return estimated + tokens.input + tokens.cache.read + tokens.cache.write + tokens.output + tokens.reasoning
  }

  // Nothing measured yet: the system prompt and tools are the only other known part of the prompt.
  return estimated + estimateSystemAndTools(baseRequest(input.context, []).system, input.context.tools)
}

/** A completed assistant response whose provider-reported usage tells us the real size of the prompt it saw. */
const hasMeasuredPrompt = (message: SessionMessage.Info) =>
  message.type === "assistant" &&
  !message.error &&
  message.tokens !== undefined &&
  message.tokens.input + message.tokens.cache.read + message.tokens.cache.write > 0

/** The prompt size that starts automatic compaction, and the most a shrunk summary request may use. */
const maxPromptTokens = (limit: SessionRunnerModel.Resolved["limit"], buffer: number) => {
  const outputReserve = Math.min(limit.output, OUTPUT_TOKEN_MAX)
  const contextCeiling = limit.context - Math.max(outputReserve, buffer)
  if (limit.input === undefined) return contextCeiling
  return Math.min(contextCeiling, limit.input - buffer)
}

/** Sent with every request but outside the conversation. */
const estimateSystemAndTools = (
  system: ReadonlyArray<{ readonly text: string }>,
  tools: SessionContext.Loaded["tools"],
) => {
  const systemTokens = system.reduce((sum, part) => sum + Token.estimate(part.text), 0)
  const toolTokens = tools.definitions.reduce(
    (sum, tool) => sum + Token.estimate(tool.name + tool.description + JSON.stringify(tool.inputSchema)),
    0,
  )
  return systemTokens + toolTokens
}

const estimateMessage = (message: Message) => message.content.reduce((sum, part) => sum + estimatePart(part), 0)

const estimatePart = (part: ContentPart): number => {
  // A native compaction is an opaque blob with no locally measurable size.
  if (part.type === "compaction") return Token.estimate(part.text ?? "")
  if (part.type === "effort") return 0
  if (part.type === "text" || part.type === "reasoning") return Token.estimate(part.text)
  if (part.type === "media") return estimateMedia(part.media.mediaType)
  if (part.type === "tool-call") return Token.estimate(part.name + (JSON.stringify(part.input) ?? ""))

  // Tool results: media inside a result counts as media, not as its placeholder text.
  if (part.result.type === "content") {
    return part.result.value.reduce((sum, content) => {
      if (content.type === "text") return sum + Token.estimate(content.text)
      return sum + estimateMedia(content.mime)
    }, 0)
  }
  return Token.estimate(toolResultText(part.result))
}

const estimateMedia = (mime: string) => {
  const type = mime.toLowerCase()
  if (type.startsWith("image/")) return IMAGE_TOKEN_ESTIMATE
  if (type === "application/pdf") return PDF_TOKEN_ESTIMATE
  return 0
}

// Splitting the conversation

/**
 * Split the conversation into `older`, which gets summarized, and `recent`, which is kept verbatim as text
 * beside the summary. Undefined when there is nothing to compact.
 */
const splitConversation = (messages: readonly SessionMessage.Info[], keepTokens: number) => {
  const entries = messages.flatMap((message, index) => {
    const text = messageToText(message)
    return text ? [{ message, text, index }] : []
  })
  if (entries.length === 0) return undefined

  const recent = entries.slice(recentStart(entries, keepTokens, lastCompaction(messages)))
  const firstRecentMessage = recent[0]?.index ?? messages.length
  return {
    older: messages.slice(0, firstRecentMessage),
    recent: recent.map((entry) => entry.text).join("\n\n"),
  }
}

/** Index into `entries` where the recent part begins. */
const recentStart = (
  entries: ReadonlyArray<{ readonly message: SessionMessage.Info; readonly text: string }>,
  keepTokens: number,
  previous: SessionMessage.CompactionCompleted | undefined,
) => {
  // Drop the oldest entries until the rest fit the allowance, but always keep the newest one.
  const dropped = Math.min(
    oldestToDrop(entries, (entry) => Token.estimate(entry.text), keepTokens),
    entries.length - 1,
  )

  // Start at a user message so an assistant's tool calls and results stay together.
  const userBoundary = entries.findLastIndex((entry, index) => index <= dropped && entry.message.type === "user")
  if (userBoundary > 0) return userBoundary

  // Everything fits. Keep only the latest exchange so there is an older part left to summarize.
  const latestUser = entries.findLastIndex((entry) => entry.message.type === "user")
  if (latestUser > 0) return latestUser

  // One exchange, nothing older. Summarize it all and keep nothing, unless a previous summary already
  // kept recent text, in which case keep everything and summarize only the summary before it.
  return previous?.recent ? 0 : entries.length
}

/** How many of the oldest items to drop so the newest ones total at most `budget`. */
const oldestToDrop = <T>(items: readonly T[], size: (item: T) => number, budget: number) => {
  let total = 0
  let start = items.length
  while (start > 0) {
    const next = total + size(items[start - 1])
    if (next > budget) break
    total = next
    start--
  }
  return start
}

const lastCompaction = (messages: readonly SessionMessage.Info[]) =>
  messages.findLast(
    (message): message is SessionMessage.CompactionCompleted =>
      message.type === "compaction" && message.status === "completed",
  )

/** The newest whole, real user messages within the allowance: no synthetic guidance, no half of an attachment or tool exchange. */
export const recentUserMessages = (
  messages: readonly SessionMessage.Info[],
  model: Pick<SessionRunnerModel.Resolved, "ref" | "capabilities">,
  keepTokens: number,
) => {
  const users = messages
    .filter((message) => message.type === "user")
    .map((message) => ({ ...message, skills: undefined }))
  const sendable = SessionModelRequest.boundImages(
    SessionModelRequest.unsupportedParts(toLLMMessages(users, model.ref), model.capabilities),
  )
  return sendable.slice(oldestToDrop(sendable, estimateMessage, keepTokens))
}

// Shrinking the conversation to text

/** The conversation as plain text entries, so a shrunk summary request carries no tool pairs or reasoning signatures. */
const conversationToText = (messages: readonly Message[]) =>
  messages.flatMap((message) => {
    const parts = message.content.flatMap((part) => {
      if (part.type === "text" || part.type === "reasoning") return part.text ? [part.text] : []
      if (part.type === "compaction") return part.text ? [part.text] : []
      if (part.type === "media") {
        const name = part.filename ? `: ${part.filename}` : ""
        return [`[Attached ${part.media.mediaType}${name}; content omitted]`]
      }
      if (part.type === "tool-call") return [`[Tool call ${part.name}(${JSON.stringify(part.input)})]`]
      if (part.type === "tool-result") {
        const output = truncateToolOutput(toolResultText(part.result), SHRUNK_TOOL_OUTPUT_CHARS)
        return [`[Tool result ${part.name}]: ${output}`]
      }
      return []
    })
    if (parts.length === 0) return []
    return [{ role: message.role, text: `[${message.role}]: ${parts.join("\n")}` }]
  })

/** Keep an earlier summary and as many of the newest exchanges as fit the budget, oldest dropped first. */
const keepNewestExchanges = (entries: ReturnType<typeof conversationToText>, budget: number) => {
  // An earlier summary leads the conversation and is always kept.
  const summary = entries[0]?.text.includes("<conversation-checkpoint>") ? entries[0].text : undefined
  const header = summary ? `${summary}\n\n` : ""

  // A user message and everything that followed it form one exchange, kept or dropped whole.
  const exchanges = entries.slice(summary ? 1 : 0).reduce<string[]>((groups, entry) => {
    if (entry.role === "user" || groups.length === 0) groups.push(entry.text)
    else groups[groups.length - 1] += `\n\n${entry.text}`
    return groups
  }, [])

  const allowance = budget - Token.estimate(header)
  if (allowance <= 0) return undefined
  const omitted = oldestToDrop(exchanges, Token.estimate, allowance)
  if (exchanges.length > 0 && omitted === exchanges.length) return undefined

  const note = omitted ? `[${omitted} older exchanges omitted from this summary input]\n\n` : ""
  return { text: header + note + exchanges.slice(omitted).join("\n\n"), omitted }
}

// Service

type EventTarget = Pick<SessionEvent.Compaction.Failed["data"], "sessionID" | "reason" | "inputID">

/** What one summary request produced: the text so far, the first failure if any, and whether it overflowed. */
type Attempt = {
  readonly text: string
  readonly overflow: boolean
  readonly failure?: SessionError.Error
  readonly providerState?: SessionMessage.ProviderState
}

/** What every attempt at one summary shares. Usage accumulates across attempts so an interruption can account for it. */
type Run = {
  readonly job: Job
  readonly prompt: string
  readonly recent: string
  readonly retries: ReturnType<typeof SessionRunnerRetry.transient>
  readonly usage: Ref.Ref<SessionUsage.Recorded | undefined>
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const llm = yield* LLMClient.Service
    const db = (yield* Database.Service).db

    const state = State.create<Settings & { readonly native: NativeStrategy[] }, Editor>({
      name: "session-compaction",
      initial: () => ({ auto: true, buffer: DEFAULT_BUFFER, tokens: DEFAULT_KEEP_TOKENS, native: [] }),
      editor: (editor) => ({
        configure: (settings) => {
          if (settings.auto !== undefined) editor.auto = settings.auto
          if (settings.buffer !== undefined) editor.buffer = settings.buffer
          if (settings.tokens !== undefined) editor.tokens = settings.tokens
        },
        native: (strategy) => {
          editor.native.push(strategy)
        },
      }),
    })

    // Events

    const eventTarget = (job: Job): EventTarget => ({
      sessionID: job.context.session.id,
      reason: job.reason,
      inputID: job.inputID,
    })

    const publishUsage = (sessionID: SessionSchema.ID, usage: SessionUsage.Recorded | undefined) => {
      if (!usage) return Effect.void
      return bus.publish(SessionEvent.UsageRecorded, { sessionID, source: "compaction", ...usage })
    }

    const publishStarted = (job: Job, recent: string) => {
      if (job.started) return Effect.void
      return bus.publish(SessionEvent.Compaction.Started, { ...eventTarget(job), recent })
    }

    const publishFailed = Effect.fnUntraced(function* (
      target: EventTarget,
      error: SessionError.Error,
      usage?: SessionUsage.Recorded,
    ) {
      yield* publishUsage(target.sessionID, usage)
      yield* bus.publish(SessionEvent.Compaction.Failed, { ...target, error, ...usage })
      return { status: "failed" as const, error }
    })

    const publishEnded = Effect.fnUntraced(function* (
      job: Job,
      result: {
        readonly text: string
        readonly recent: string
        readonly providerState?: SessionMessage.ProviderState
        readonly providerContext?: SessionProviderContext.Info
        readonly usage?: SessionUsage.Recorded
        readonly metadata?: Record<string, unknown>
      },
    ) {
      const context = job.context
      yield* publishUsage(context.session.id, result.usage)
      yield* bus.publish(
        SessionEvent.Compaction.Ended,
        {
          sessionID: context.session.id,
          reason: job.reason,
          model: context.model.ref,
          providerState: result.providerState,
          providerContext: result.providerContext,
          text: result.text,
          recent: result.recent,
          ...result.usage,
        },
        { metadata: result.metadata },
      )
      return { status: "completed" as const }
    })

    /** A request hook produced the summary itself, so no model call happens. */
    const publishHookResult = (job: Job, result: SessionCompactionResult, recent: string) =>
      publishEnded(job, {
        text: result.summary,
        recent,
        providerState: result.providerState,
        usage: result.tokens && {
          tokens: result.tokens,
          cost: SessionUsage.calculateCost(job.context.model.cost, result.tokens),
        },
        metadata: result.metadata,
      })

    // Manual compactions settle through the inbox; only automatic ones need a durable interruption record.
    const publishInterrupted = Effect.fnUntraced(function* (job: Job, usage?: SessionUsage.Recorded) {
      yield* publishUsage(job.context.session.id, usage)
      if (job.reason !== "auto") return
      yield* publishFailed(eventTarget(job), { type: "compaction.interrupted", message: "Compaction was interrupted" })
    })

    // Requests

    /** Run the request hooks over a system prompt and messages. */
    const prepareRequest = (
      job: Job,
      request: Pick<SessionModelRequest.Input, "system" | "messages">,
      webSocket?: "session",
    ) =>
      job.prepare({
        session: job.context.session,
        agent: job.context.agent.id,
        model: job.context.model,
        tools: job.context.tools,
        system: request.system,
        messages: request.messages,
        webSocket,
      })

    /** The conversation as the runner would send it, plus any instruction update waiting to be delivered. */
    const conversationRequest = (job: Job, messages: readonly SessionMessage.Info[], webSocket?: "session") => {
      const base = baseRequest(job.context, messages)
      const update = job.instructionUpdate ? [Message.system(job.instructionUpdate)] : []
      return prepareRequest(job, { system: base.system, messages: [...base.messages, ...update] }, webSocket)
    }

    const retryPolicy = Effect.fnUntraced(function* (job: Job, hook: SessionModelRequest.Prepared["retry"]) {
      const policy = yield* SessionRunnerRetry.policy(job.context.session.id)
      return SessionRunnerRetry.transient(policy, {
        agent: job.context.agent.id,
        model: job.context.model.ref,
        hook,
      })
    })

    /**
     * Every message since the last summary, with native compactions replaced by the messages they stand for.
     * A native compaction is an opaque blob: it cannot be summarized or shrunk, but its originals can.
     */
    const originalMessages = (sessionID: SessionSchema.ID) =>
      SessionHistory.load(db, sessionID, "local").pipe(Effect.orDie)

    // Summary

    const summarize = Effect.fn("SessionCompaction.summarize")(function* (job: Job) {
      const context = job.context
      const messages = job.overflow ? yield* originalMessages(context.session.id) : context.messages
      const split = splitConversation(messages, state.get().tokens)
      if (!split) {
        return yield* publishFailed(eventTarget(job), {
          type: "compaction.unavailable",
          message: "Nothing to compact yet",
        })
      }
      yield* publishStarted(job, split.recent)

      const previous = lastCompaction(split.older)
      const prompt = buildPrompt(previous !== undefined, previous?.summary.includes(LEGACY_HEADING) ?? false)
      const prepared = yield* conversationRequest(job, split.older)
      if (prepared.event.result) return yield* publishHookResult(job, prepared.event.result, split.recent)

      const run: Run = {
        job,
        prompt,
        recent: split.recent,
        retries: yield* retryPolicy(job, prepared.retry),
        usage: yield* Ref.make<SessionUsage.Recorded | undefined>(undefined),
      }

      // How much conversation fits once the system prompt, tools, and summary instructions are counted.
      const limit = context.model.limit
      const fixed = estimateSystemAndTools(prepared.request.system, context.tools) + Token.estimate(prompt)
      const budget = limit.context > 0 ? maxPromptTokens(limit, state.get().buffer) - fixed : undefined

      // Skip the normal request when the conversation cannot fit the window at all.
      const window = Math.min(limit.context, limit.input ?? Number.POSITIVE_INFINITY)
      const size = estimateTokens({ messages: split.older, context }) + Token.estimate(prompt)
      const tooBig = budget !== undefined && budget > 0 && size > window
      if (!tooBig) {
        const attempt = yield* generate(run, prepared.request, prepared.options)
        if (!attempt.overflow) return yield* finish(run, attempt, 0)
      }
      return yield* shrinkAndRetry(run, prepared, budget)
    })

    /** The summary request overflowed. Flatten the conversation to text and drop the oldest exchanges until it fits. */
    const shrinkAndRetry = Effect.fnUntraced(function* (
      run: Run,
      prepared: Effect.Success<ReturnType<SessionModelRequest.Interface["compaction"]>>,
      budget: number | undefined,
    ) {
      const job = run.job
      const entries = conversationToText(prepared.request.messages)
      const system = baseRequest(job.context, []).system
      let allowance = budget ?? Token.estimate(entries.map((entry) => entry.text).join("\n\n"))
      let previousText: string | undefined

      for (let attempt = 1; ; attempt++) {
        const kept = keepNewestExchanges(entries, allowance)
        if (!kept || kept.text === previousText) {
          return yield* publishFailed(
            eventTarget(job),
            {
              type: "compaction.failed",
              message: "The summary input cannot be reduced further without losing the latest exchange or checkpoint",
            },
            yield* Ref.get(run.usage),
          )
        }

        const reduced = yield* prepareRequest(job, { system, messages: [Message.user(kept.text)] })
        if (reduced.event.result) {
          yield* publishUsage(job.context.session.id, yield* Ref.get(run.usage))
          return yield* publishHookResult(job, reduced.event.result, run.recent)
        }

        const result = yield* generate(run, reduced.request, reduced.options)
        if (!result.overflow || attempt === MAX_SHRINK_ATTEMPTS) return yield* finish(run, result, kept.omitted)
        allowance = Math.floor(allowance / 2)
        previousText = kept.text
      }
    })

    /** Ask for the summary, and once more with a reminder if the model ignored the template. */
    const generate = Effect.fnUntraced(function* (run: Run, request: LLMRequest, options: StreamOptions) {
      // Hooks saw the request without the summary prompt; it is appended after they ran.
      const prompted = LLMRequest.update(request, { messages: [...request.messages, Message.user(run.prompt)] })
      const first = yield* stream(run, prompted, options)
      if (first.failure || hasSummarySection(first.text)) return first

      const nudged = LLMRequest.update(prompted, { messages: [...prompted.messages, Message.user(NUDGE)] })
      return yield* stream(run, nudged, options)
    })

    /** Publish the summary, or the failure if there is no usable one. */
    const finish = Effect.fnUntraced(function* (run: Run, attempt: Attempt, omitted: number) {
      const usage = yield* Ref.get(run.usage)
      if (attempt.failure || !hasSummarySection(attempt.text)) {
        const message = attempt.text.trim()
          ? "Compaction summary did not match the required template"
          : "Compaction produced no summary"
        return yield* publishFailed(
          eventTarget(run.job),
          attempt.failure ?? { type: "compaction.failed", message },
          usage,
        )
      }

      const note = omitted
        ? `\n\n[${omitted} older exchanges were omitted from the summary input; original session history is retained.]`
        : ""
      return yield* publishEnded(run.job, {
        text: attempt.text + note,
        recent: run.recent,
        providerState: attempt.providerState,
        usage,
      })
    })

    /** One model call, folded into what it produced. */
    const stream = (run: Run, request: LLMRequest, options: StreamOptions) => {
      const context = run.job.context
      const metadataKey = context.model.model.route.providerMetadataKey ?? context.model.model.provider

      const step = (attempt: Attempt, event: LLMEvent): Effect.Effect<Attempt, AIError> => {
        if (LLMEvent.is.providerError(event)) {
          const overflow = event.classification === "context-overflow"
          const type = overflow ? "provider.invalid-request" : "provider.error"
          return Effect.succeed({ ...attempt, overflow, failure: { type, message: event.message } })
        }

        if (LLMEvent.is.textDelta(event)) {
          return bus
            .publish(SessionEvent.Compaction.Delta, { sessionID: context.session.id, text: event.text })
            .pipe(Effect.as({ ...attempt, text: attempt.text + event.text }))
        }

        if (LLMEvent.is.stepFinish(event)) {
          return Ref.update(run.usage, (total) => {
            const recorded = SessionUsage.record(event.usage, context.model.cost)
            return total ? SessionUsage.add(total, recorded) : recorded
          }).pipe(Effect.as({ ...attempt, providerState: event.providerMetadata?.[metadataKey] }))
        }

        if (!LLMEvent.is.finish(event)) return Effect.succeed(attempt)
        switch (event.reason.normalized) {
          case "unknown":
            return Effect.fail(
              new AIError({
                reason: new InvalidProviderOutputError({
                  message: "The provider response ended with an unknown finish reason.",
                  classification: "incomplete-stream",
                }),
              }),
            )
          case "error":
            return Effect.fail(
              new AIError({ reason: new UnknownProviderError({ message: "Compaction generation failed" }) }),
            )
          case "length":
            return Effect.succeed({
              ...attempt,
              failure: { type: "compaction.failed", message: "Compaction summary reached the output token limit" },
            })
          case "content-filter":
            return Effect.succeed({
              ...attempt,
              failure: { type: "provider.content-filter", message: "Compaction summary was blocked by the provider" },
            })
          default:
            return Effect.succeed(attempt)
        }
      }

      return llm.stream(request, options).pipe(
        Stream.runFoldEffect((): Attempt => ({ text: "", overflow: false }), step),
        run.retries,
        Effect.catchTag("AI.Error", (error) =>
          Effect.succeed<Attempt>({
            text: "",
            overflow: isContextOverflowFailure(error),
            failure: toSessionError(error),
          }),
        ),
        Effect.onInterrupt(() =>
          Ref.get(run.usage).pipe(Effect.flatMap((usage) => publishInterrupted(run.job, usage))),
        ),
      )
    }

    // Native compaction

    const nativeCompaction = Effect.fn("SessionCompaction.native")(function* (job: Job) {
      const context = job.context
      const unsupported = (message: string) =>
        publishFailed(eventTarget(job), { type: "provider.unsupported-operation", message })

      const prepared = yield* conversationRequest(job, context.messages, "session")
      if (prepared.event.result) {
        yield* publishStarted(job, "")
        return yield* publishHookResult(job, prepared.event.result, "")
      }
      const request = prepared.request

      // The result only works on the exact endpoint that made it, so that endpoint must be known up front.
      // History is selected before request hooks, so a hook that reroutes the request cannot be honored here.
      const provenance = SessionProviderContext.provenance(context.model)
      if (!provenance) return yield* unsupported("Provider compaction requires a stable, configured endpoint")
      const routed = SessionProviderContext.provenance({ model: request.model, ref: context.model.ref })
      if (!SessionProviderContext.compatible(provenance, routed)) {
        return yield* unsupported(
          "Provider compaction requires the endpoint in provider/model settings, not a model.request rewrite",
        )
      }

      const retained = originalMessages(context.session.id).pipe(
        Effect.map((messages) => recentUserMessages(messages, context.model, state.get().tokens)),
      )
      const strategy = state
        .get()
        .native.toReversed()
        .map((strategy) => strategy({ request, options: prepared.options, retained }))
        .find((effect) => effect !== undefined)
      if (!strategy) {
        return yield* unsupported(
          `No plugin provides native compaction for ${request.model.provider}/${request.model.route.id}`,
        )
      }

      const retries = yield* retryPolicy(job, prepared.retry)
      yield* publishStarted(job, "")

      const onResult = (result: NativeResult) =>
        publishEnded(job, {
          text: "",
          recent: "",
          providerContext: SessionProviderContext.encode(provenance, result.replacement),
          usage: result.usage && SessionUsage.record(result.usage, context.model.cost),
        })
      // Only an automatic compaction may fall back to a summary when the provider rejects the window as too long.
      const onError = (cause: AIError): Effect.Effect<Outcome> => {
        if (job.reason !== "auto" || !isContextOverflowFailure(cause)) {
          return publishFailed(eventTarget(job), toSessionError(cause))
        }
        return summarize({ ...job, overflow: true, started: true }).pipe(
          Effect.map((result) => (result.status === "completed" ? { ...result, recoveredOverflow: true } : result)),
        )
      }
      // Nothing is installed until the provider returns, so the install itself must not be interrupted.
      return yield* Effect.uninterruptibleMask((restore) =>
        restore(strategy.pipe(retries)).pipe(Effect.flatMap(onResult)),
      ).pipe(
        Effect.onInterrupt(() => publishInterrupted(job)),
        Effect.catchTag("AI.Error", onError),
      )
    })

    // Entry points

    const runCompaction = (job: Job) =>
      job.context.model.compaction?.type === "native" ? nativeCompaction(job) : summarize(job)

    const compact = Effect.fn("SessionCompaction.compact")(function* (input: AutoInput): Effect.fn.Return<Outcome> {
      const job = { ...input, reason: "auto" as const }
      // The loaded messages were just rejected as too long; a native compaction of them would be too.
      return yield* input.overflow ? summarize(job) : runCompaction(job)
    })

    const required = (input: RequiredInput) => {
      const config = state.get()
      if (!config.auto) return false

      // A compaction just completed; let the runner rebuild the request from it first.
      const last = input.messages.at(-1)
      if (last?.type === "compaction" && last.status === "completed") return false

      // After a native compaction, wait for a response to it before estimating: the usage recorded by the
      // compaction itself describes that operation, not the size of the window it produced.
      const measuredIndex = input.messages.findLastIndex(hasMeasuredPrompt)
      const nativeIndex = input.messages.findLastIndex(SessionProviderContext.isCheckpoint)
      if (measuredIndex < nativeIndex) return false

      const limit = input.context.model.limit
      if (limit.context <= 0) return false
      return estimateTokens(input) >= maxPromptTokens(limit, config.buffer)
    }

    const compactManual = Effect.fn("SessionCompaction.compactManual")(function* (input: ManualInput) {
      const target: EventTarget = { sessionID: input.session.id, reason: "manual", inputID: input.inputID }
      if (splitConversation(input.messages, state.get().tokens) === undefined) {
        return yield* publishFailed(target, { type: "compaction.unavailable", message: "Nothing to compact yet" })
      }
      return yield* input.resolveContext(input.session).pipe(
        Effect.matchEffect({
          onFailure: (cause) => publishFailed(target, toSessionError(cause)),
          onSuccess: (context) =>
            runCompaction({
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
  deps: [Bus.node, Database.node, llmClient],
})

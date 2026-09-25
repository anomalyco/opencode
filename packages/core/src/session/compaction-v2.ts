export * as SessionCompaction from "./compaction-v2.js"

import {
  AIError,
  type ContentPart,
  InvalidProviderOutputError,
  InvalidRequestError,
  isContextOverflowFailure,
  LLMClient,
  LLMEvent,
  LLMRequest,
  Message,
  type ToolEntry,
  UnknownProviderError,
  type Usage,
} from "@opencode/ai"
import type { StreamOptions } from "@opencode/ai/route"
import type { SessionCompactionResult } from "@opencode/plugin/effect/session"
import type { SessionError } from "@opencode/schema/session-error"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Result, Stream } from "effect"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { llmClient } from "../effect/app-node-platform.js"
import { State } from "../state.js"
import { Token } from "../util/token.js"
import type { SessionContext } from "./context.js"
import { SessionEvent } from "./event.js"
import { SessionHistory } from "./history.js"
import type { SessionMessage } from "./message.js"
import { SessionModelRequest } from "./model-request.js"
import { SessionProviderContext } from "./provider-context.js"
import { SessionRunnerRetry } from "./runner/retry.js"
import { toLLMMessages } from "./runner/to-llm-message.js"
import { toSessionError } from "./to-session-error.js"
import { SessionUsage } from "./usage.js"

export type Settings = {
  auto: boolean
  /** Tokens kept free below the model's limits before compacting. Unset keeps 10% free. */
  buffer?: number
  /** Tokens of recent conversation kept verbatim beside the summary. */
  keep: number
}

export type Editor = {
  configure: (settings: Partial<Settings>) => void
}

export type Trigger =
  /** `overflow`: the provider just rejected this context as too long. */
  | { readonly reason: "auto" | "overflow"; readonly context: SessionContext.Loaded }
  /** `inputID` is the `/compact` inbox item, whose message shows the outcome. */
  | { readonly reason: "manual"; readonly context: SessionContext.Loaded; readonly inputID: SessionMessage.ID }

export type Outcome =
  /** Only `auto` skips: the context fits, or automatic compaction is off. */
  | { readonly status: "skipped" }
  | { readonly status: "completed" }
  | { readonly status: "failed"; readonly error: SessionError.Error }

export interface Interface extends State.Transformable<Editor> {
  readonly compact: (trigger: Trigger) => Effect.Effect<Outcome>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

/** A summary fills `text` and `recent`; a native compaction fills `providerContext`. */
type Result = {
  readonly text: string
  readonly recent: string
  readonly providerState?: SessionMessage.ProviderState
  readonly providerContext?: SessionProviderContext.Info
  readonly usage?: SessionUsage.Recorded
  readonly metadata?: Record<string, unknown>
}

type Failure = {
  readonly error: SessionError.Error
  readonly usage?: SessionUsage.Recorded
}

type Prepared = Effect.Success<ReturnType<SessionModelRequest.Interface["compaction"]>>

/**
 * `send` is one attempt at whatever version of the request the loop hands it. It fails with `AIError` for what
 * the provider rejected, which the loop may retry, and with a `Failure` for a reply that cannot be used.
 */
type Mechanism = {
  readonly prepared: Prepared
  /** Kept verbatim beside the result; the compaction message shows it while running. */
  readonly recent: string
  /** Tokens `send` adds to every request it is handed, such as the summary prompt. */
  readonly overhead: number
  readonly send: (request: LLMRequest, options: StreamOptions) => Effect.Effect<Result, AIError | Failure>
}

type Streamed = {
  readonly text: string
  readonly providerState?: SessionMessage.ProviderState
  readonly usage?: SessionUsage.Recorded
}

const MAX_REJECTIONS = 3
const TOOL_OUTPUT_MAX_CHARS = 2_000
const IMAGE_TOKEN_ESTIMATE = 1_500
const PDF_TOKEN_ESTIMATE = 2_000

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

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const llm = yield* LLMClient.Service
    const db = (yield* Database.Service).db
    const requests = yield* SessionModelRequest.Service

    const state = State.create<Settings, Editor>({
      name: "session-compaction",
      initial: () => ({ auto: true, keep: 15_000 }),
      editor: (settings) => ({
        configure: (update) => {
          Object.assign(settings, update)
        },
      }),
    })

    const compact = Effect.fn("SessionCompaction.compact")(function* (trigger: Trigger): Effect.fn.Return<Outcome> {
      const settings = state.get()
      const context = trigger.context

      // Only the user compacts when automatic compaction is off, overflow included.
      if (trigger.reason !== "manual" && !settings.auto) return { status: "skipped" }
      const max = ceiling(context.model.limit, settings.buffer)
      if (trigger.reason === "auto" && !due(context, max)) return { status: "skipped" }

      const built = yield* Effect.result(
        context.model.compaction?.type === "native" ? compactNatively(context, settings) : summarize(context, settings),
      )
      if (Result.isFailure(built)) return yield* publish(trigger, built.failure)
      const mechanism = built.success
      // The runner opened the manual compaction's message when it delivered the `/compact` item.
      if (trigger.reason !== "manual") {
        yield* bus.publish(SessionEvent.Compaction.Started, {
          sessionID: context.session.id,
          reason: "auto",
          recent: mechanism.recent,
        })
      }
      const supplied = mechanism.prepared.event.result
      if (supplied) return yield* publish(trigger, yield* fromHook(context, supplied, mechanism.recent))

      // Each pass sends the least-changed version of the request estimated to fit `target`: as-is, lightened, then
      // flattened. A "too long" rejection means the estimate ran low, so the next target is 70% of the rejected
      // request's estimate, and the third rejection gives up. Anything else transient resends the same version
      // under the session's retry policy.
      const policy = yield* SessionRunnerRetry.policy(context.session.id)
      let target = max - mechanism.overhead
      let rejections = 0

      while (true) {
        const request = fit(mechanism.prepared.request, context, target)
        if (!request) {
          return yield* publish(trigger, {
            error: {
              type: "compaction.failed",
              message: "The summary input cannot be reduced further without losing the latest exchange or checkpoint",
            },
          })
        }

        const outcome = yield* Effect.result(mechanism.send(request, mechanism.prepared.options))
        if (Result.isSuccess(outcome)) return yield* publish(trigger, outcome.success)
        const cause = outcome.failure
        if (!(cause instanceof AIError)) return yield* publish(trigger, cause)
        const error = toSessionError(cause)

        if (isContextOverflowFailure(cause)) {
          rejections++
          if (rejections === MAX_REJECTIONS) return yield* publish(trigger, { error })
          target = Math.floor(estimateRequest(request) * 0.7)
          continue
        }

        const decision = yield* policy({
          cause,
          error,
          agent: context.agent.id,
          model: context.model.ref,
          hook: mechanism.prepared.retry,
          retry: SessionRunnerRetry.isRetryable(cause),
        })
        if (!decision.retry) return yield* publish(trigger, { error })
        yield* Effect.sleep(decision.delay)
      }
    })

    const due = (context: SessionContext.Loaded, ceiling: number) => {
      const messages = context.messages
      // A compaction just completed; let the runner rebuild the request from it first.
      const last = messages.at(-1)
      if (last?.type === "compaction" && last.status === "completed") return false
      // An encrypted native window estimates as nothing, so wait for a response to measure it.
      const measured = messages.findLastIndex((message) => hasMeasuredPrompt(message, context.model.ref))
      if (measured < messages.findLastIndex(SessionProviderContext.isCheckpoint)) return false
      return estimateContext(context) >= ceiling
    }

    const fit = (request: LLMRequest, context: SessionContext.Loaded, target: number): LLMRequest | undefined => {
      if (estimateRequest(request) <= target) return request
      const lighter = lighten(request, target)
      if (estimateRequest(lighter) <= target) return lighter
      return flatten(request, context, target)
    }

    /** Tool outputs at the end, newest first, then media, replaced by placeholders until the estimate fits. */
    const lighten = (request: LLMRequest, target: number): LLMRequest => {
      throw new Error(`not implemented: lighten(${request.messages.length}, ${target})`)
    }

    /**
     * `[previous compaction][transcript]`: tool outputs replaced, reasoning and media left out, oldest exchanges
     * dropped until the estimate fits. Undefined when the previous compaction and newest exchange alone do not.
     */
    const flatten = (request: LLMRequest, context: SessionContext.Loaded, target: number): LLMRequest | undefined => {
      throw new Error(`not implemented: flatten(${request.messages.length}, ${context.session.id}, ${target})`)
    }

    /** A text summary of the older conversation; the newest `keep` tokens stay verbatim beside it. */
    const summarize = Effect.fnUntraced(function* (
      context: SessionContext.Loaded,
      settings: Settings,
    ): Effect.fn.Return<Mechanism, Failure> {
      const split = splitConversation(context.messages, settings.keep)
      if (!split) {
        return yield* Effect.fail<Failure>({
          error: { type: "compaction.unavailable", message: "Nothing to compact yet" },
        })
      }

      const [oldest] = split.older
      const previous = oldest?.type === "compaction" && oldest.status === "completed" ? oldest : undefined
      const prompt = buildPrompt(previous !== undefined, previous?.summary.includes(LEGACY_HEADING) ?? false)
      const headings = SUMMARY_TEMPLATE.split("\n").filter((line) => line.startsWith("##"))
      const filled = (text: string) => text.split("\n").some((line) => headings.includes(line.trim()))

      return {
        prepared: yield* prepare(context, split.older),
        recent: split.recent,
        overhead: Token.estimate(prompt) + Token.estimate(NUDGE),
        // Hooks saw the request without the summary prompt, so it is appended here. A reply that ignores the
        // template gets one reminder before it counts as a failure.
        send: (request, options) =>
          Effect.gen(function* () {
            const prompted = LLMRequest.update(request, { messages: [...request.messages, Message.user(prompt)] })
            const reply = yield* stream(context, prompted, options)
            if (filled(reply.text)) return { ...reply, recent: split.recent }

            const nudged = LLMRequest.update(prompted, { messages: [...prompted.messages, Message.user(NUDGE)] })
            const retry = yield* stream(context, nudged, options)
            const usage = reply.usage && retry.usage ? SessionUsage.add(reply.usage, retry.usage) : retry.usage
            if (filled(retry.text)) return { ...retry, usage, recent: split.recent }
            return yield* Effect.fail<Failure>({
              error: {
                type: "compaction.failed",
                message: retry.text.trim()
                  ? "Compaction summary did not match the required template"
                  : "Compaction produced no summary",
              },
              usage,
            })
          }),
      }
    })

    const stream = (context: SessionContext.Loaded, request: LLMRequest, options: StreamOptions) => {
      const sessionID = context.session.id
      const metadataKey = context.model.model.route.providerMetadataKey ?? context.model.model.provider
      const unusable = (streamed: Streamed, error: SessionError.Error) =>
        Effect.fail<Failure>({ error, usage: streamed.usage })

      return llm.stream(request, options).pipe(
        Stream.runFoldEffect(
          (): Streamed => ({ text: "" }),
          (streamed, event): Effect.Effect<Streamed, AIError | Failure> => {
            if (LLMEvent.is.providerError(event)) {
              if (event.classification !== "context-overflow")
                return unusable(streamed, { type: "provider.error", message: event.message })
              return Effect.fail(
                new AIError({
                  reason: new InvalidRequestError({ message: event.message, classification: "context-overflow" }),
                }),
              )
            }

            if (LLMEvent.is.textDelta(event)) {
              return bus
                .publish(SessionEvent.Compaction.Delta, { sessionID, text: event.text })
                .pipe(Effect.as({ ...streamed, text: streamed.text + event.text }))
            }

            if (LLMEvent.is.stepFinish(event)) {
              const usage = SessionUsage.record(event.usage, context.model.cost)
              return spend(sessionID, usage).pipe(
                Effect.as({
                  ...streamed,
                  providerState: event.providerMetadata?.[metadataKey],
                  usage: streamed.usage ? SessionUsage.add(streamed.usage, usage) : usage,
                }),
              )
            }

            if (!LLMEvent.is.finish(event)) return Effect.succeed(streamed)
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
                return unusable(streamed, {
                  type: "compaction.failed",
                  message: "Compaction summary reached the output token limit",
                })
              case "content-filter":
                return unusable(streamed, {
                  type: "provider.content-filter",
                  message: "Compaction summary was blocked by the provider",
                })
              default:
                return Effect.succeed(streamed)
            }
          },
        ),
      )
    }

    /**
     * The provider compacts its own window into an opaque replacement, which only replays on the endpoint that
     * made it. A checkpoint mechanism returns just the compacted item, so the newest real user messages are
     * carried in front of it; an endpoint mechanism returns the whole replacement window.
     */
    const compactNatively = Effect.fnUntraced(function* (
      context: SessionContext.Loaded,
      settings: Settings,
    ): Effect.fn.Return<Mechanism, Failure> {
      const unsupported = (message: string) =>
        Effect.fail<Failure>({ error: { type: "provider.unsupported-operation", message } })
      const prepared = yield* prepare(context, context.messages, "session")

      // History is selected before request hooks, so a hook that reroutes the request cannot be honored here.
      const provenance = SessionProviderContext.provenance(context.model)
      if (!provenance) return yield* unsupported("Provider compaction requires a stable, configured endpoint")
      const routed = SessionProviderContext.provenance({ model: prepared.request.model, ref: context.model.ref })
      if (!SessionProviderContext.compatible(provenance, routed)) {
        return yield* unsupported(
          "Provider compaction requires the endpoint in provider/model settings, not a model.request rewrite",
        )
      }

      const install = (replacement: ReadonlyArray<Message>, usage: Usage | undefined) => {
        const recorded = usage && SessionUsage.record(usage, context.model.cost)
        return spend(context.session.id, recorded).pipe(
          Effect.as<Result>({
            text: "",
            recent: "",
            providerContext: SessionProviderContext.encode(provenance, replacement),
            usage: recorded,
          }),
        )
      }

      return {
        prepared,
        recent: "",
        overhead: 0,
        send: (request, options) => {
          if (LLMClient.canCompact(request, { mechanism: "trigger" })) {
            return Effect.gen(function* () {
              const originals = yield* SessionHistory.load(db, context.session.id, "local").pipe(Effect.orDie)
              const retained = recentUserMessages(originals, context.model, settings.keep)
              const response = yield* llm.compact(request, { ...options, mechanism: "trigger" })
              return yield* install([...retained, Message.assistant(response.checkpoint)], response.usage)
            })
          }
          if (LLMClient.canCompact(request)) {
            return llm
              .compact(request, { mechanism: "endpoint", http: options.http })
              .pipe(Effect.flatMap((response) => install(response.replacement, response.usage)))
          }
          return unsupported(
            `No plugin provides native compaction for ${request.model.provider}/${request.model.route.id}`,
          )
        },
      }
    })

    /** The conversation as the runner would send it, after request hooks. */
    const prepare = (
      context: SessionContext.Loaded,
      messages: ReadonlyArray<SessionMessage.Info>,
      webSocket?: "session",
    ) => {
      const base = transcript(context, messages)
      return requests.compaction({
        session: context.session,
        agent: context.agent.id,
        model: context.model,
        tools: context.tools,
        system: base.system,
        messages: base.messages,
        webSocket,
      })
    }

    /** A request hook supplied the summary itself, so no model call happens. */
    const fromHook = (context: SessionContext.Loaded, supplied: SessionCompactionResult, recent: string) => {
      const usage = supplied.tokens && {
        tokens: supplied.tokens,
        cost: SessionUsage.calculateCost(context.model.cost, supplied.tokens),
      }
      return spend(context.session.id, usage).pipe(
        Effect.as<Result>({
          text: supplied.summary,
          recent,
          providerState: supplied.providerState,
          usage,
          metadata: supplied.metadata,
        }),
      )
    }

    /** Each model call records its usage as it finishes, so failed and interrupted compactions are billed too. */
    const spend = (sessionID: SessionContext.Loaded["session"]["id"], usage: SessionUsage.Recorded | undefined) =>
      usage ? bus.publish(SessionEvent.UsageRecorded, { sessionID, source: "compaction", ...usage }) : Effect.void

    const publish = Effect.fnUntraced(function* (
      trigger: Trigger,
      outcome: Result | Failure,
    ): Effect.fn.Return<Outcome> {
      const context = trigger.context
      const sessionID = context.session.id
      const reason = trigger.reason === "manual" ? "manual" : "auto"

      if ("error" in outcome) {
        yield* bus.publish(SessionEvent.Compaction.Failed, {
          sessionID,
          reason,
          inputID: trigger.reason === "manual" ? trigger.inputID : undefined,
          error: outcome.error,
          ...outcome.usage,
        })
        return { status: "failed", error: outcome.error }
      }

      yield* bus.publish(
        SessionEvent.Compaction.Ended,
        {
          sessionID,
          reason,
          model: context.model.ref,
          providerState: outcome.providerState,
          providerContext: outcome.providerContext,
          text: outcome.text,
          recent: outcome.recent,
          ...outcome.usage,
        },
        { metadata: outcome.metadata },
      )
      return { status: "completed" }
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      // A manual compaction settles through its `/compact` inbox item, which the runner owns.
      compact: (trigger) =>
        compact(trigger).pipe(
          Effect.onInterrupt(() =>
            trigger.reason === "manual"
              ? Effect.void
              : publish(trigger, { error: { type: "compaction.interrupted", message: "Compaction was interrupted" } }),
          ),
        ),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, Database.node, llmClient, SessionModelRequest.node],
})

const transcript = (context: SessionContext.Loaded, messages: ReadonlyArray<SessionMessage.Info>) =>
  SessionModelRequest.baseTranscript({
    agent: context.agent.info,
    model: context.model,
    tools: context.tools,
    initial: context.initial,
    messages,
  })

/**
 * `older` gets summarized; `recent`, the newest messages within `keep` tokens, is kept verbatim as text beside
 * the summary. Undefined when there is nothing to compact.
 */
const splitConversation = (messages: ReadonlyArray<SessionMessage.Info>, keep: number) => {
  const entries = messages.flatMap((message, index) => {
    const text = messageToText(message)
    return text ? [{ message, text, index }] : []
  })
  if (entries.length === 0) return undefined

  const [oldest] = messages
  const previous = oldest?.type === "compaction" && oldest.status === "completed" ? oldest : undefined
  const recent = entries.slice(recentStart(entries, keep, previous))
  return {
    older: messages.slice(0, recent[0]?.index ?? messages.length),
    recent: recent.map((entry) => entry.text).join("\n\n"),
  }
}

const recentStart = (
  entries: ReadonlyArray<{ readonly message: SessionMessage.Info; readonly text: string }>,
  keep: number,
  previous: SessionMessage.CompactionCompleted | undefined,
) => {
  // Drop the oldest entries until the rest fit the allowance, but always keep the newest one.
  const dropped = Math.min(
    oldestToDrop(entries, (entry) => Token.estimate(entry.text), keep),
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

const oldestToDrop = <T>(items: ReadonlyArray<T>, size: (item: T) => number, budget: number) => {
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

const truncateToolOutput = (value: string) => {
  if (value.length <= TOOL_OUTPUT_MAX_CHARS) return value

  // Count code points so a surrogate pair is never split.
  let end = 0
  let kept = 0
  for (const char of value) {
    if (kept === TOOL_OUTPUT_MAX_CHARS) break
    end += char.length
    kept++
  }
  if (end === value.length) return value
  return `${value.slice(0, end)}\n[truncated]`
}

const serializeToolContent = (content: ReadonlyArray<SessionMessage.ToolStateCompleted["content"][number]>) =>
  content
    .map((item) => {
      if (item.type === "text") return item.text
      return `[Attached ${item.mime}${item.name === undefined ? "" : `: ${item.name}`}]`
    })
    .join("\n")

/** The newest whole, real user messages within `keep` tokens: no synthetic guidance, no half of an attachment. */
export const recentUserMessages = (
  messages: ReadonlyArray<SessionMessage.Info>,
  model: Pick<SessionContext.Loaded["model"], "ref" | "capabilities">,
  keep: number,
) => {
  const users = messages
    .filter((message) => message.type === "user")
    .map((message) => ({ ...message, skills: undefined }))
  const sendable = SessionModelRequest.boundImages(
    SessionModelRequest.unsupportedParts(toLLMMessages(users, model.ref), model.capabilities),
  )
  return sendable.slice(oldestToDrop(sendable, estimateMessage, keep))
}

export const estimateContext = (context: SessionContext.Loaded) => {
  const anchorIndex = context.messages.findLastIndex((message) => hasMeasuredPrompt(message, context.model.ref))
  const anchor = context.messages[anchorIndex]
  const base = transcript(context, context.messages.slice(Math.max(0, anchorIndex)))
  // The anchor's usage covers its own output, but not its local tool results, which the provider never saw.
  const unmeasured = SessionModelRequest.unsupportedParts(base.messages, context.model.capabilities).filter(
    (message) => message.role !== "assistant" || message.id !== anchor?.id,
  )

  if (anchor?.type !== "assistant" || !anchor.tokens)
    return estimateRequest({ system: base.system, tools: context.tools.definitions, messages: unmeasured })

  const tokens = anchor.tokens
  const measured = tokens.input + tokens.cache.read + tokens.cache.write + tokens.output + tokens.reasoning
  return measured + unmeasured.reduce((sum, message) => sum + estimateMessage(message), 0)
}

/** The largest request the model takes while leaving room for its reply. */
const ceiling = (limit: SessionContext.Loaded["model"]["limit"], buffer: number | undefined) => {
  // An unknown window is reported as 0; only a provider rejection can limit it then.
  if (limit.context <= 0) return Number.POSITIVE_INFINITY
  const window = limit.input ?? limit.context
  return buffer === undefined ? Math.floor(window * 0.9) : window - buffer
}

/**
 * Another model's count used another tokenizer, and after a provider switch may describe a native window
 * whose originals this history has since expanded.
 */
const hasMeasuredPrompt = (message: SessionMessage.Info, model: SessionContext.Loaded["model"]["ref"]) =>
  message.type === "assistant" &&
  message.model.providerID === model.providerID &&
  message.model.id === model.id &&
  !message.error &&
  message.tokens !== undefined &&
  message.tokens.input + message.tokens.cache.read + message.tokens.cache.write > 0

const estimateRequest = (request: Pick<LLMRequest, "system" | "tools" | "messages">) =>
  request.system.reduce((sum, part) => sum + Token.estimate(part.text), 0) +
  request.tools.reduce((sum, tool) => sum + estimateTool(tool), 0) +
  request.messages.reduce((sum, message) => sum + estimateMessage(message), 0)

/** Only what providers receive; `metadata` and `native` stay local. */
const estimateTool = (tool: ToolEntry): number => {
  if (tool.type === "tool") return Token.estimate(tool.name + tool.description + JSON.stringify(tool.inputSchema))
  return (
    Token.estimate(tool.name + (tool.description ?? "")) +
    tool.tools.reduce((sum, entry) => sum + estimateTool(entry), 0)
  )
}

const estimateMessage = (message: Message) => message.content.reduce((sum, part) => sum + estimatePart(part), 0)

const estimatePart = (part: ContentPart): number => {
  // An encrypted native compaction has no locally measurable size.
  if (part.type === "compaction") return Token.estimate(part.text ?? "")
  if (part.type === "effort") return 0
  if (part.type === "text" || part.type === "reasoning") return Token.estimate(part.text)
  if (part.type === "media") return estimateMedia(part.media.mediaType)
  if (part.type === "tool-call") return Token.estimate(part.name + (JSON.stringify(part.input) ?? ""))

  if (part.result.type === "content")
    return part.result.value.reduce(
      (sum, content) => sum + (content.type === "text" ? Token.estimate(content.text) : estimateMedia(content.mime)),
      0,
    )
  const value = part.result.value
  return Token.estimate(typeof value === "string" ? value : (JSON.stringify(value) ?? ""))
}

const estimateMedia = (mime: string) => {
  const type = mime.toLowerCase()
  if (type.startsWith("image/")) return IMAGE_TOKEN_ESTIMATE
  if (type === "application/pdf") return PDF_TOKEN_ESTIMATE
  return 0
}

export * as SessionCompaction from "./compaction-v2.js"

import {
  type AIError,
  type ContentPart,
  isContextOverflowFailure,
  LLMClient,
  LLMRequest,
  type Message,
  type ToolEntry,
} from "@opencode/ai"
import type { StreamOptions } from "@opencode/ai/route"
import type { SessionError } from "@opencode/schema/session-error"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Result } from "effect"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { llmClient } from "../effect/app-node-platform.js"
import { State } from "../state.js"
import { Token } from "../util/token.js"
import type { SessionContext } from "./context.js"
import { SessionEvent } from "./event.js"
import type { SessionMessage } from "./message.js"
import { SessionModelRequest } from "./model-request.js"
import { SessionProviderContext } from "./provider-context.js"
import { SessionRunnerRetry } from "./runner/retry.js"
import { toSessionError } from "./to-session-error.js"
import type { SessionUsage } from "./usage.js"

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
  readonly overflow: boolean
  readonly usage?: SessionUsage.Recorded
}

type Prepared = Effect.Success<ReturnType<SessionModelRequest.Interface["compaction"]>>

/** `send` is one attempt at whatever version of the request the loop hands it; it fails with `AIError` for anything the provider rejected. */
type Mechanism = {
  readonly prepared: Prepared
  /** Tokens `send` adds to every request it is handed, such as the summary prompt. */
  readonly overhead: number
  readonly send: (request: LLMRequest, options: StreamOptions) => Effect.Effect<Result, AIError>
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

      const mechanism = yield* context.model.compaction?.type === "native"
        ? compactNatively(trigger)
        : summarize(trigger, settings)
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
            overflow: true,
          })
        }

        const outcome = yield* Effect.result(mechanism.send(request, mechanism.prepared.options))
        if (Result.isSuccess(outcome)) return yield* publish(trigger, outcome.success)
        const cause = outcome.failure
        const error = toSessionError(cause)

        if (isContextOverflowFailure(cause)) {
          rejections++
          if (rejections === MAX_REJECTIONS) return yield* publish(trigger, { error, overflow: true })
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
        if (!decision.retry) return yield* publish(trigger, { error, overflow: false })
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

    const compactNatively = (trigger: Trigger): Effect.Effect<Mechanism> =>
      Effect.die(`not implemented: compactNatively(${trigger.reason})`)

    const summarize = (trigger: Trigger, settings: Settings): Effect.Effect<Mechanism> =>
      Effect.die(`not implemented: summarize(${trigger.reason}, ${settings.keep})`)

    const publish = Effect.fnUntraced(function* (
      trigger: Trigger,
      outcome: Result | Failure,
    ): Effect.fn.Return<Outcome> {
      const context = trigger.context
      const sessionID = context.session.id
      const reason = trigger.reason === "manual" ? "manual" : "auto"

      if (outcome.usage)
        yield* bus.publish(SessionEvent.UsageRecorded, { sessionID, source: "compaction", ...outcome.usage })

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

    const INTERRUPTED: Failure = {
      error: { type: "compaction.interrupted", message: "Compaction was interrupted" },
      overflow: false,
    }

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      compact: (trigger) => compact(trigger).pipe(Effect.onInterrupt(() => publish(trigger, INTERRUPTED))),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, Database.node, llmClient, SessionModelRequest.node],
})

export const estimateContext = (context: SessionContext.Loaded) => {
  const anchorIndex = context.messages.findLastIndex((message) => hasMeasuredPrompt(message, context.model.ref))
  const anchor = context.messages[anchorIndex]
  const base = SessionModelRequest.baseTranscript({
    agent: context.agent.info,
    model: context.model,
    tools: context.tools,
    initial: context.initial,
    messages: context.messages.slice(Math.max(0, anchorIndex)),
  })
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

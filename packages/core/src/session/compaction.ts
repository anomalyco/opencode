export * as SessionCompaction from "./compaction.js"

import { LLM, LLMError, LLMEvent, Message, type LLMRequest, type Model } from "@bolt-ai/llm"
import { DateTime, Effect, Stream } from "effect"
import type { Config } from "../config"
import type { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { Token } from "../util/token"

export type Settings = {
  auto: boolean
  /** Tokens kept free below the model's limits before compacting. Unset keeps 15%, and at least 16k, free. */
  buffer?: number
  /** Tokens of recent conversation kept verbatim beside the summary. */
  keep: number
  /** Summarize in the background as the context nears the threshold, so automatic compaction can swap it in. */
  precompute: boolean
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
  /**
   * Starts a background summary when the context nears the threshold. Never waits for it. Loads `context` only when
   * background summaries are on.
   */
  readonly precompute: <E>(context: Effect.Effect<SessionContext.Loaded, E>) => Effect.Effect<void, E>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

/**
 * A summary fills `text`, and references the messages it keeps verbatim with `metadata.keepID`; history
 * rebuilds their text from that. A native compaction fills `native.messages` with its replacement window.
 */
type Result = {
  readonly text: string
  readonly native?: SessionMessage.Native
  readonly metadata?: Record<string, unknown>
}

type Failure = {
  readonly error: SessionError.Error
}

type Prepared = Effect.Success<ReturnType<SessionModelRequest.Interface["compaction"]>>

type Streamed = {
  readonly text: string
}

/** A summary run off the critical path: it covers only `messages`, streams no deltas, and bills into `usage`. */
type Background = {
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly usage: (usage: SessionUsage.Recorded) => void
}

/** A background summary of everything before `keepID`, held until automatic compaction is due. */
type Precomputed = {
  readonly firstID: SessionMessage.ID | undefined
  readonly keepID: SessionMessage.ID
  readonly model: SessionContext.Loaded["model"]["ref"]
  readonly initial: string
  /** The longest tail since `keepID` that compaction still accepts beside this summary. */
  readonly tailLimit: number
  /** Background summaries that failed since the last compaction, this one included once it has. */
  readonly failures: number
  readonly usage: SessionUsage.Recorded[]
  readonly fiber: Fiber.Fiber<Result, Failure>
}

const NOTHING_TO_COMPACT: Failure = { error: { type: "compaction.unavailable", message: "Nothing to compact yet" } }
/** After each "too long" rejection, the next attempt aims at this share of the first rejected request's size. */
const SHRINK_STEPS = [0.85, 0.7, 0.5, 0.35]
// The least of the window kept free for the last reply before compaction and for the summary itself.
const RESERVE_MIN = 16_000
/**
 * Share of the window kept free before automatic compaction. Above `RESERVE_MIN`, the margin between it and
 * `summaryRoom` absorbs a large step past the trigger, so the whole conversation still goes out unchanged and reuses
 * the cache. Single steps grew by up to ~22k tokens at p99 in real sessions.
 */
const RESERVE_SHARE = 0.15
/** A common window size, assumed for the compaction request when the model's window is unknown. */
const UNKNOWN_WINDOW = 200_000
/** A summary gets at least this much output, or the room left if less, even when the estimate margin leaves less. */
const SUMMARY_OUTPUT_FLOOR = 32_000
/**
 * How far one exchange of a summary transcript is shortened, in the order the levels apply: whole; tool outputs cut;
 * tool outputs left out and tool inputs cut; only the user's text, cut; omitted.
 */
const OUTPUTS_CLIPPED = 1
const OUTPUTS_REMOVED = 2
const USER_ONLY = 3
const OMITTED = 4
const TRANSCRIPT_LEVELS = [0, OUTPUTS_CLIPPED, OUTPUTS_REMOVED, USER_ONLY, OMITTED]
/** Characters kept, from the start and end, of a cut tool input, tool output, or user message. */
const TRANSCRIPT_CLIP = 2_000
const IMAGE_TOKEN_ESTIMATE = 1_500
const PDF_TOKEN_ESTIMATE = 2_000
/** Share of the compaction ceiling at which a background summary starts. */
const PRECOMPUTE_RATIO = 0.85
/** Measured prompt tokens below which a background summary is not worth its cost. */
const PRECOMPUTE_MIN_TOKENS = 64_000
/**
 * The most text a swapped-in summary keeps verbatim beside it: twice `keep`, at least 30k, at most a quarter of the
 * budget. A longer tail would leave the context near the threshold, so compaction summarizes from scratch instead.
 */
const PRECOMPUTED_TAIL_MIN = 30_000
const PRECOMPUTED_TAIL_SHARE = 0.25
/** Failed background summaries after which no new one starts until the next compaction. */
const PRECOMPUTE_MAX_FAILURES = 2

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
    // Before #48058 (Sep 2026), summaries kept nearly everything: every file touched, per-edit changelogs,
    // restated AGENTS.md conventions, and an "Additional Context" section that grew on every update. The
    // preserve-first update prompt would carry that detail forward indefinitely, so a checkpoint from that
    // template is rewritten once at the current level of detail. The rewrite uses the new headings, so later
    // updates skip this. Remove once no session still in use has a latest checkpoint older than #48058.
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
    const agents = yield* Agent.Service
    const bus = yield* Bus.Service
    const llm = yield* LLMClient.Service
    const catalog = yield* Model.Service
    const models = yield* SessionRunnerModel.Service
    const db = (yield* Database.Service).db
    const requests = yield* SessionModelRequest.Service

    const scope = yield* Scope.Scope
    const precomputed = new Map<SessionContext.Loaded["session"]["id"], Precomputed>()

    const state = State.create<Settings, Editor>({
      name: "session-compaction",
      initial: () => ({ auto: true, keep: 15_000, precompute: false }),
      editor: (settings) => ({
        configure: (update) => {
          Object.assign(settings, update)
        },
      }),
    })

    /** The model that writes the summary, and the request size it aims for. */
    const selectModel = Effect.fnUntraced(function* (
      context: SessionContext.Loaded,
      buffer: number | undefined,
      native: boolean,
    ) {
      const agent = native ? undefined : yield* agents.get(Agent.ID.make("compaction"))
      const model =
        (agent?.model &&
          (yield* models
            .resolve({ ...context.session, model: agent.model }, catalog.available)
            .pipe(Effect.orElseSucceed(() => undefined)))) ??
        context.model
      const ceiling = calculateCeiling(model.limit, buffer)
      // An unknown window never triggers auto compaction, but the compaction request still needs a size to aim for.
      const cap = Number.isFinite(ceiling)
        ? ceiling
        : calculateCeiling({ ...model.limit, context: UNKNOWN_WINDOW }, buffer)
      return { context: model === context.model ? context : { ...context, model }, cap }
    })

    const compact = Effect.fn("SessionCompaction.compact")(function* (trigger: Trigger): Effect.fn.Return<Outcome> {
      const settings = state.get()
      const context = trigger.context

      // Only the user compacts when automatic compaction is off, overflow included.
      if (trigger.reason !== "manual" && !settings.auto) return { status: "skipped" }
      if (trigger.reason === "auto" && !due(context, calculateCeiling(context.model.limit, settings.buffer)))
        return { status: "skipped" }
      const held = precomputed.get(context.session.id)
      precomputed.delete(context.session.id)
      const native = context.model.compaction?.type === "native"
      const model = yield* selectModel(context, settings.buffer, native)
      // The provider just rejected this context, so the estimate ran low; the first attempt already aims below it.
      const budget =
        trigger.reason === "overflow"
          ? Math.min(model.cap, Math.floor(estimateContext(context) * SHRINK_STEPS[0]))
          : model.cap

      const selected = model.context === context ? trigger : { ...trigger, context: model.context }
      // The runner opened the manual compaction's message when it delivered the `/compact` item. An automatic one
      // opens here, before any wait, so a background summary still being written shows as a running compaction.
      if (trigger.reason !== "manual")
        yield* bus.publish(SessionEvent.Compaction.Started, { sessionID: context.session.id, reason: "auto" })
      const swapped = held ? yield* usePrecomputed(selected, held, budget, settings) : undefined
      const compaction = swapped
        ? Effect.succeed(swapped)
        : native
          ? compactNatively(selected, budget, settings.keep)
          : summarize(selected, budget, settings.keep)
      return yield* compaction.pipe(
        Effect.matchEffect({
          onSuccess: (result) => publish(selected, result),
          onFailure: (failure) => publish(selected, failure),
        }),
      )
    })

    /**
     * Once the context passes `PRECOMPUTE_RATIO` of the ceiling, summarizes everything before the latest response in
     * the background. That is the prefix the provider just processed, so the summary request reads it from the prompt
     * cache. The summary is held, not applied: swapping it in now would rewrite the prefix and throw away the cache
     * for every step until compaction is actually due. One summary is held per Session until compaction takes it, or
     * until it fails or falls too far behind, when a newer response replaces it.
     */
    const precompute = Effect.fn("SessionCompaction.precompute")(function* <E>(
      load: Effect.Effect<SessionContext.Loaded, E>,
    ) {
      const settings = state.get()
      if (!settings.precompute || !settings.auto) return
      const context = yield* load
      if (context.model.compaction?.type === "native") return
      const ceiling = calculateCeiling(context.model.limit, settings.buffer)
      if (!Number.isFinite(ceiling) || due(context, ceiling)) return
      if (estimateContext(context) < ceiling * PRECOMPUTE_RATIO) return

      const anchorIndex = context.messages.findLastIndex((message) => hasMeasuredPrompt(message, context.model.ref))
      const anchor = context.messages[anchorIndex]
      if (anchorIndex <= 0 || anchor?.type !== "assistant" || !anchor.tokens) return
      if (anchor.tokens.input + anchor.tokens.cache.read + anchor.tokens.cache.write < PRECOMPUTE_MIN_TOKENS) return

      const sessionID = context.session.id
      const existing = precomputed.get(sessionID)
      const exit = existing?.fiber.pollUnsafe()
      const failed = exit !== undefined && Exit.isFailure(exit)
      const failures = (existing?.failures ?? 0) + (failed ? 1 : 0)
      if (existing) {
        const index = heldIndex(existing, context)
        if (index >= 0 && !failed && tailTokens(context, index) <= existing.tailLimit) return
        // Summarizing up to the same response again would repeat the same request.
        if (index >= 0 && (existing.keepID === anchor.id || failures >= PRECOMPUTE_MAX_FAILURES)) return
        yield* Fiber.interrupt(existing.fiber)
        precomputed.delete(sessionID)
      }
      // After a model switch nothing is cached for the new model yet; wait until its first response has written it.
      if (anchor.model.id !== context.model.ref.id || anchor.model.variant !== context.model.ref.variant) return

      const model = yield* selectModel(context, settings.buffer, false)
      const usage: SessionUsage.Recorded[] = []
      const fiber = yield* summarize({ reason: "auto", context: model.context }, model.cap, settings.keep, {
        messages: context.messages.slice(0, anchorIndex),
        usage: (recorded) => usage.push(recorded),
      }).pipe(Effect.forkIn(scope))
      precomputed.set(sessionID, {
        firstID: context.messages[0]?.id,
        keepID: anchor.id,
        model: context.model.ref,
        initial: context.initial,
        tailLimit: tailLimit(settings.keep, model.cap),
        failures,
        usage,
        fiber,
      })
    })

    /**
     * The held summary plus everything since it, kept verbatim, when it still describes this conversation and that
     * tail is short. Waits for a summary still being written. Undefined, after stopping the background work, when it
     * cannot be used; compaction then summarizes as usual.
     */
    const usePrecomputed = Effect.fnUntraced(function* (
      trigger: Trigger,
      held: Precomputed,
      budget: number,
      settings: Settings,
    ): Effect.fn.Return<Result | undefined> {
      const context = trigger.context
      const index = heldIndex(held, context)
      const usable =
        settings.precompute &&
        trigger.reason !== "overflow" &&
        context.model.compaction?.type !== "native" &&
        index >= 0 &&
        tailTokens(context, index) <= tailLimit(settings.keep, budget)
      if (!usable) {
        yield* Fiber.interrupt(held.fiber)
        return undefined
      }

      const exit = yield* Fiber.await(held.fiber).pipe(Effect.onInterrupt(() => Fiber.interrupt(held.fiber)))
      if (Exit.isFailure(exit)) return undefined
      // Background calls were billed as they finished; the compaction's message still shows what it cost.
      held.usage.forEach((usage) => addSpent(context.session.id, usage))
      return { ...exit.value, metadata: { keepID: held.keepID, ...exit.value.metadata } }
    })

    const due = (context: SessionContext.Loaded, ceiling: number) => {
      const messages = context.messages
      // A compaction just completed; let the runner rebuild the request from it first.
      const last = messages.at(-1)
      if (last?.type === "compaction" && last.status === "completed") return false
      // An encrypted native window estimates as nothing, so wait for a response to measure it.
      const measured = messages.findLastIndex((message) => hasMeasuredPrompt(message, context.model.ref))
      if (measured < messages.findLastIndex(SessionHistory.isNativeCompaction)) return false
      return estimateContext(context) >= ceiling
    }

    /**
     *   first:  [E1 … E8][E9 E10]                  →  [S1 + "E9 E10"]
     *   again:  [S1 + "E9 E10"][E11 … E18][E19]    →  [S2 + "E19"]      S2 covers the whole current conversation
     *
     * The model is sent the whole conversation, including the tail kept beside the summary, then the summary prompt.
     * Keeping the normal request's prefix intact lets the summary reuse its prompt cache:
     *
     *   [system][S1 + "E9 E10"][E11 … E18][E19][prompt]    plus one nudge if the reply skips the template
     *
     * Later requests open with the checkpoint as one user message:
     *
     *   <conversation-checkpoint>
     *     <summary>S2</summary>
     *     <recent-context>E19</recent-context>
     *   </conversation-checkpoint>
     *   [new messages…]
     *
     * E = one exchange: a user message and the replies to it. S = a summary. [S + "…"] = one checkpoint: a summary
     * plus the newest `keep` tokens of messages, referenced by their first message and sent as text.
     */
    const summarize = Effect.fnUntraced(function* (
      trigger: Trigger,
      budget: number,
      keep: number,
      background?: Background,
    ): Effect.fn.Return<Result, Failure> {
      const context = trigger.context
      const messages = background?.messages ?? context.messages
      const split = splitConversation(messages, keep)
      if (split === undefined) return yield* Effect.fail(NOTHING_TO_COMPACT)
      // A background summary covers all of its messages; what follows them is kept when it is swapped in.
      const keepID = background ? undefined : split.keepID

      const previous = previousCompaction(messages)
      const prompt = buildPrompt(previous !== undefined, previous?.summary.includes(LEGACY_HEADING) ?? false)
      const headings = SUMMARY_TEMPLATE.split("\n").filter((line) => line.startsWith("##"))
      const filled = (text: string) => text.split("\n").some((line) => headings.includes(line.trim()))
      const prepared = yield* prepare(context, messages, budget)

      // Hooks saw the request without the summary prompt, so it is appended here. A reply that ignores the
      // template gets one reminder before it counts as a failure.
      const send = (request: LLMRequest) =>
        Effect.gen(function* () {
          const prompted = fitOutput(
            LLMRequest.update(request, { messages: [...request.messages, Message.user(prompt)] }),
            context.model.limit,
          )
          const reply = yield* stream(context, prompted, prepared.options, background)
          if (filled(reply.text)) return reply

          const nudged = fitOutput(
            LLMRequest.update(prompted, { messages: [...prompted.messages, Message.user(NUDGE)] }),
            context.model.limit,
          )
          const retry = yield* stream(context, nudged, prepared.options, background)
          if (filled(retry.text)) return retry
          return yield* Effect.fail<Failure>({
            error: {
              type: "compaction.failed",
              message: retry.text.trim()
                ? "Compaction summary did not match the required template"
                : "Compaction produced no summary",
            },
          })
        })

      const overhead = Token.estimate(prompt) + Token.estimate(NUDGE)
      // Automatic compaction starts past the ceiling, so the whole conversation is sent unchanged while the window can
      // still fit the summary. Below that, the history before the tail is sent instead, as before: unchanged when it fits,
      // which still reuses the cache for that shorter prefix, and as text otherwise. Dropping exchanges to make room
      // for the tail would leave them in neither the summary nor the tail. Where 15% of the window is under
      // `RESERVE_MIN`, the ceiling equals `summaryRoom`, so automatic compaction always takes this fallback.
      const fit = trigger.reason === "overflow" ? budget : Math.max(budget, summaryRoom(context.model.limit))
      const result = yield* deliver(
        trigger,
        prepared,
        budget - overhead,
        send,
        { fit: fit - overhead, history: withoutTail(prepared.request, keepID) },
        background,
      )
      if (!keepID) return result
      // A compaction hook may choose its own kept range.
      return { ...result, metadata: { keepID, ...result.metadata } }
    })

    /**
     *   endpoint:  [window]                      →  [U U][item]    the provider picks which messages to keep
     *   trigger:   [window][compaction_trigger]  →  [item]
     *                                            →  [U U][item]    we add the newest user messages within `keep`
     *
     * Later requests open with that replacement window in place of the history it covers:
     *
     *   [U U][item][new messages…]
     *
     * window = the previous compaction and everything since. item = one encrypted compaction item, which only
     * replays on the model that made it. U = a user message as typed.
     */
    const compactNatively = Effect.fnUntraced(function* (
      trigger: Trigger,
      budget: number,
      keep: number,
    ): Effect.fn.Return<Result, Failure> {
      const context = trigger.context
      if (!context.messages.some(SessionRecentText.messageToText)) return yield* Effect.fail(NOTHING_TO_COMPACT)
      const unsupported = (message: string) =>
        Effect.fail<Failure>({ error: { type: "provider.unsupported-operation", message } })
      const prepared = yield* prepare(context, context.messages, budget, "session")

      const toResult = (window: ReadonlyArray<Message>, usage: Usage | undefined) =>
        spend(context.session.id, usage && SessionUsage.record(usage, context.model.cost)).pipe(
          Effect.as<Result>({
            text: "",
            // Plain JSON, not the schema encoder: provider metadata can hold undefined entries, which it rejects.
            native: { messages: JSON.parse(JSON.stringify(window)) },
          }),
        )

      const send = (request: LLMRequest) => {
        if (LLMClient.canCompact(request, { mechanism: "trigger" })) {
          return Effect.gen(function* () {
            const history = yield* SessionHistory.load(db, context.session.id, "local").pipe(Effect.orDie)
            const retained = recentUserMessages(history, context.model, keep)
            const response = yield* llm.compact(request, { ...prepared.options, mechanism: "trigger" })
            return yield* toResult([...retained, Message.assistant(response.checkpoint)], response.usage)
          })
        }
        if (LLMClient.canCompact(request)) {
          return llm
            .compact(request, { mechanism: "endpoint", http: prepared.options.http })
            .pipe(Effect.flatMap((response) => toResult(response.replacement, response.usage)))
        }
        return unsupported(`Native compaction is not supported for ${request.model.provider}/${request.model.route.id}`)
      }

      return yield* deliver(trigger, prepared, budget, send)
    })

    /**
     * Sends the request as-is if it is estimated to fit `shrink.fit`, else `shrink.history` as-is if it fits `target`,
     * and otherwise `shrink.history` as text aimed at `target` (see `flattenAndDropOldest`).
     * Limits and estimates can be wrong, so until the provider rejects something as too long, a request that cannot
     * be made to fit is sent whole: unchanged, or as text once its media has to go. A "too long" rejection means the
     * estimate ran low, so the next attempts aim at 85%, 70%, 50%, then 35% of the first rejected request's estimate,
     * each shortening the transcript again from scratch, and a rejection after those gives up. A "payload too large"
     * rejection is about bytes, which inline media almost always accounts for, so one on the unchanged request resends
     * it as text, which carries no media, without counting; one on text counts as "too long". Other provider errors
     * resend the same request under the session's retry policy. A `Failure` from `send` is a reply that cannot be
     * used, and is never retried.
     */
    const deliver = Effect.fnUntraced(function* (
      trigger: Trigger,
      prepared: Prepared,
      target: number,
      send: (request: LLMRequest) => Effect.Effect<Result, AIError | Failure>,
      shrink: { readonly fit: number; readonly history: LLMRequest } = { fit: target, history: prepared.request },
      background?: Background,
    ): Effect.fn.Return<Result, Failure> {
      const context = trigger.context
      if (prepared.event.result) return yield* fromHook(context, prepared.event.result, background)

      const policy = yield* SessionRunnerRetry.policy(context.session.id)
      let rejections = 0
      let rejected: number | undefined
      let asText = false
      let fit = shrink.fit

      while (true) {
        const unchanged = asText
          ? undefined
          : estimateRequest(prepared.request) <= fit
            ? prepared.request
            : estimateRequest(shrink.history) <= target
              ? shrink.history
              : undefined
        const request =
          unchanged ??
          flattenAndDropOldest(shrink.history, context, target) ??
          (rejections > 0
            ? undefined
            : asText
              ? flattenAndDropOldest(shrink.history, context, Number.POSITIVE_INFINITY)
              : shrink.history)
        if (!request) {
          return yield* Effect.fail<Failure>({
            error: {
              type: "compaction.failed",
              message:
                "The compaction request cannot be reduced further without losing the latest exchange or checkpoint",
            },
          })
        }

        const attempt = yield* Effect.result(send(request))
        if (Result.isSuccess(attempt)) return attempt.success
        const cause = attempt.failure
        if (!(cause instanceof AIError)) return yield* Effect.fail(cause)
        const error = toSessionError(cause)
        const tooLarge = cause.reason._tag === "InvalidRequest" && cause.reason.classification === "payload-too-large"

        if (tooLarge && (request === prepared.request || request === shrink.history)) {
          asText = true
          continue
        }

        if (tooLarge || isContextOverflowFailure(cause)) {
          const step = SHRINK_STEPS[rejections]
          if (step === undefined) return yield* Effect.fail<Failure>({ error })
          rejected ??= estimateRequest(request)
          target = Math.floor(rejected * step)
          fit = target
          rejections++
          continue
        }

        const decision = yield* policy({
          cause,
          error,
          agent: context.agent.id,
          model: context.model.ref,
          hook: prepared.retry,
          retry: SessionRunnerRetry.isRetryable(cause),
        })
        if (!decision.retry) return yield* Effect.fail<Failure>({ error })
        yield* Effect.sleep(decision.delay)
      }
    })

    /**
     * History that has to change is sent as text rather than as edited messages: `[previous compaction][transcript]`,
     * the conversation since that compaction as one text message. A previous summary always stays in front, while
     * its verbatim recent part becomes the oldest transcript entry; a previous native window stays exactly as the
     * provider made it. The transcript has no tool definitions, which the summary does not need and which no longer
     * share a cached prefix, and leaves out reasoning, media, and instruction updates.
     *
     * When the whole transcript does not fit, exchanges are shortened oldest first, one level at a time, until it
     * does (see `flattenMessage` for the levels): every exchange reaches a level before any reaches the next, so
     * detail is lost from the oldest history first and whole exchanges are omitted only as a last resort. The newest
     * exchange is never omitted; undefined when the transcript cannot fit even so.
     */
    const flattenAndDropOldest = (request: LLMRequest, context: SessionContext.Loaded, target: number) => {
      const previous = previousCompaction(context.messages)
      const end =
        request.messages.findLastIndex(
          (message) =>
            (previous !== undefined && message.id === previous.id) ||
            message.content.some((part) => part.type === "compaction"),
        ) + 1
      const summary = previous !== undefined && !SessionHistory.isNativeCompaction(previous) ? previous : undefined
      // TODO: Read the previous summary from the hooked request once it no longer merges summary and recent into one
      // message. Until then it is rebuilt from storage, which drops a compaction hook's edits to that message.
      const lead = summary
        ? toLLMMessages([{ ...summary, metadata: { ...summary.metadata, recent: "" } }], context.model.ref)
        : request.messages.slice(0, end)
      const recent = summary ? SessionRecentText.kept(summary) : ""

      // A user message and everything after it, up to the next one, is one exchange. Each is rendered at every level
      // once, so shortening is running arithmetic over these sizes. The previous summary's recent part is already
      // shortened text: whole until it is omitted.
      const exchanges = [
        ...(recent ? [TRANSCRIPT_LEVELS.map((level) => (level === OMITTED ? "" : recent))] : []),
        ...request.messages
          .slice(end)
          .reduce<Message[][]>((groups, message) => {
            if (message.role === "user" || groups.length === 0) groups.push([message])
            else groups[groups.length - 1].push(message)
            return groups
          }, [])
          .map((group) =>
            TRANSCRIPT_LEVELS.map((level) =>
              group
                .map((message) => flattenMessage(message, level))
                .filter(Boolean)
                .join("\n"),
            ),
          )
          .filter((renders) => renders[0]),
      ]
      if (exchanges.length === 0) return undefined
      const note = (omitted: number) =>
        omitted ? `[${omitted} older ${omitted === 1 ? "exchange" : "exchanges"} omitted]\n\n` : ""
      const size = (text: string) => (text ? Token.estimate(text) + 1 : 0)
      // Room for the longest possible note is set aside before choosing what to keep.
      const room =
        target -
        estimateRequest({ system: request.system, tools: [], messages: lead }) -
        Token.estimate(note(exchanges.length))

      const levels = exchanges.map(() => 0)
      let total = exchanges.reduce((sum, renders) => sum + size(renders[0]), 0)
      const newest = exchanges.length - 1
      for (const level of TRANSCRIPT_LEVELS.slice(1)) {
        for (let index = 0; index < exchanges.length && total > room; index++) {
          // The newest exchange is what the summary most needs; it is shortened but never left out.
          if (index === newest && !exchanges[index][level]) continue
          total += size(exchanges[index][level]) - size(exchanges[index][levels[index]])
          levels[index] = level
        }
      }
      if (total > room) return undefined

      // Includes exchanges with no user text, which are already gone at `USER_ONLY`.
      const omitted = levels.filter((level, index) => !exchanges[index][level]).length
      const text = exchanges
        .map((renders, index) => renders[levels[index]])
        .filter(Boolean)
        .join("\n\n")
      return LLMRequest.update(request, { tools: [], messages: [...lead, Message.user(note(omitted) + text)] })
    }

    const stream = (
      context: SessionContext.Loaded,
      request: LLMRequest,
      options: StreamOptions,
      background?: Background,
    ) => {
      const sessionID = context.session.id
      const unusable = (error: SessionError.Error) => Effect.fail<Failure>({ error })

      return llm.stream(request, options).pipe(
        Stream.runFoldEffect(
          (): Streamed => ({ text: "" }),
          (streamed, event): Effect.Effect<Streamed, AIError | Failure> => {
            if (LLMEvent.is.providerError(event)) {
              if (event.classification === undefined)
                return unusable({ type: "provider.error", message: event.message })
              return Effect.fail(
                new AIError({
                  reason: new InvalidRequestError({ message: event.message, classification: event.classification }),
                }),
              )
            }

            if (LLMEvent.is.textDelta(event)) {
              const next = { ...streamed, text: streamed.text + event.text }
              if (background) return Effect.succeed(next)
              return bus.publish(SessionEvent.Compaction.Delta, { sessionID, text: event.text }).pipe(Effect.as(next))
            }

            if (LLMEvent.is.stepFinish(event)) {
              return spend(sessionID, SessionUsage.record(event.usage, context.model.cost), background?.usage).pipe(
                Effect.as(streamed),
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
                return unusable({
                  type: "compaction.failed",
                  message: "Compaction summary reached the output token limit",
                })
              case "content-filter":
                return unusable(contentFilterError("Compaction summary was blocked by the provider", event.reason))
              default:
                return Effect.succeed(streamed)
            }
          },
        ),
      )
    }

    /**
     * The conversation as the runner would send it, after request hooks.
     *
     * The output limit leaves room for `budget`, the most `deliver` sends. The request prepared here can be larger
     * when the conversation overshot the threshold, and is only shrunk to fit after hooks have seen it, so sizing the
     * output to it would leave next to no room. A prompt the estimate undersells is rejected and shrunk like any
     * other.
     */
    const prepare = (
      context: SessionContext.Loaded,
      messages: ReadonlyArray<SessionMessage.Info>,
      budget: number,
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
        inputTokens: { measured: budget, estimated: 0 },
      })
    }

    /** A request hook supplied the summary itself, so no model call happens. */
    const fromHook = (context: SessionContext.Loaded, supplied: SessionCompactionResult, background?: Background) => {
      const usage = supplied.tokens && {
        tokens: supplied.tokens,
        cost: SessionUsage.calculateCost(context.model.cost, supplied.tokens),
      }
      return spend(context.session.id, usage, background?.usage).pipe(
        Effect.as<Result>({
          text: supplied.summary,
          native: supplied.native,
          metadata: supplied.metadata,
        }),
      )
    }

    /**
     * Each model call is billed as soon as it finishes, so failed and interrupted compactions are billed too. The
     * compaction's message shows the total across all of its calls. A session never runs two compactions at once;
     * a background summary keeps its own total until a compaction takes it.
     */
    const spent = new Map<SessionContext.Loaded["session"]["id"], SessionUsage.Recorded>()
    const addSpent = (sessionID: SessionContext.Loaded["session"]["id"], usage: SessionUsage.Recorded) => {
      const total = spent.get(sessionID)
      spent.set(sessionID, total ? SessionUsage.add(total, usage) : usage)
    }
    const spend = (
      sessionID: SessionContext.Loaded["session"]["id"],
      usage: SessionUsage.Recorded | undefined,
      record = (recorded: SessionUsage.Recorded) => addSpent(sessionID, recorded),
    ) =>
      Effect.gen(function* () {
        if (!usage) return
        record(usage)
        yield* bus.publish(SessionEvent.UsageRecorded, { sessionID, source: "compaction", ...usage })
      })

    const publish = Effect.fnUntraced(function* (
      trigger: Trigger,
      outcome: Result | Failure,
    ): Effect.fn.Return<Outcome> {
      const context = trigger.context
      const sessionID = context.session.id
      const reason = trigger.reason === "manual" ? "manual" : "auto"
      const usage = spent.get(sessionID)

      if ("error" in outcome) {
        yield* bus.publish(SessionEvent.Compaction.Failed, {
          sessionID,
          reason,
          inputID: trigger.reason === "manual" ? trigger.inputID : undefined,
          error: outcome.error,
          ...usage,
        })
        return { status: "failed", error: outcome.error }
      }

      yield* bus.publish(
        SessionEvent.Compaction.Ended,
        {
          sessionID,
          reason,
          model: context.model.ref,
          native: outcome.native,
          text: outcome.text,
          ...usage,
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
          Effect.ensuring(Effect.sync(() => spent.delete(trigger.context.session.id))),
        ),
      precompute,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Agent.node, Bus.node, Database.node, llmClient, Model.node, SessionModelRequest.node, SessionRunnerModel.node],
})

/**
 * Where the messages kept beside a held summary start, or -1 when the summary no longer describes this
 * conversation: a compaction or revert since replaced its start, or the model or instructions changed.
 */
const heldIndex = (held: Precomputed, context: SessionContext.Loaded) => {
  if (held.firstID !== context.messages[0]?.id || held.initial !== context.initial) return -1
  if (held.model.providerID !== context.model.ref.providerID || held.model.id !== context.model.ref.id) return -1
  if (held.model.variant !== context.model.ref.variant) return -1
  return context.messages.findIndex((message) => message.id === held.keepID)
}

/** Estimated text a swapped-in summary keeps verbatim: every message from `index` on. */
const tailTokens = (context: SessionContext.Loaded, index: number) =>
  Token.estimate(context.messages.slice(index).map(SessionRecentText.messageToText).filter(Boolean).join("\n\n"))

const tailLimit = (keep: number, budget: number) =>
  Math.min(Math.max(keep * 2, PRECOMPUTED_TAIL_MIN), Math.floor(budget * PRECOMPUTED_TAIL_SHARE))

/** History loads from the latest completed compaction, so a previous one is always the first message. */
const previousCompaction = (messages: ReadonlyArray<SessionMessage.Info>) => {
  const [first] = messages
  return first?.type === "compaction" && first.status === "completed" ? first : undefined
}

const transcript = (context: SessionContext.Loaded, messages: ReadonlyArray<SessionMessage.Info>) =>
  SessionModelRequest.baseTranscript({
    agent: context.agent.info,
    model: context.model,
    tools: context.tools,
    initial: context.initial,
    messages,
  })

/**
 * The newest messages within `keep` tokens, from `keepID` on, are kept verbatim beside the summary.
 * Undefined when there is nothing to compact.
 */
const splitConversation = (messages: ReadonlyArray<SessionMessage.Info>, keep: number) => {
  const entries = messages.flatMap((message) => {
    const text = SessionRecentText.messageToText(message)
    return text ? [{ message, text }] : []
  })
  if (entries.length === 0) return undefined

  const first = entries[recentStart(entries, keep, previousCompaction(messages))]
  return {
    keepID: first?.message.id,
  }
}

/** The request without the retained tail, which starts at the message with ID `from`. */
const withoutTail = (request: LLMRequest, from: SessionMessage.ID | undefined) => {
  const index = from === undefined ? -1 : request.messages.findIndex((message) => message.id === from)
  if (index < 0) return request
  return LLMRequest.update(request, { messages: request.messages.slice(0, index) })
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

  // Everything fits. Keep only the latest exchange rather than duplicating the whole conversation beside the summary.
  const latestUser = entries.findLastIndex((entry) => entry.message.type === "user")
  if (latestUser > 0) return latestUser

  // One exchange, nothing older. Summarize it all and keep nothing, unless a previous summary already
  // kept recent text, in which case keep everything and summarize only the summary before it.
  return previous && SessionRecentText.kept(previous) ? 0 : entries.length
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

/** One request message as transcript lines at a shortening level. Empty for what that level leaves out. */
const flattenMessage = (message: Message, level: number) => {
  if (message.role === "system" || level === OMITTED) return ""
  if (level >= USER_ONLY && message.role !== "user") return ""
  return message.content
    .flatMap((part) => {
      if (part.type === "text") {
        if (!part.text) return []
        const text = level >= USER_ONLY ? clip(part.text) : part.text
        return [`[${message.role === "user" ? "User" : "Assistant"}]: ${text}`]
      }
      if (level >= USER_ONLY) return []
      if (part.type === "media") return [`[${part.media.mediaType} omitted]`]
      if (part.type === "tool-call") {
        const input = JSON.stringify(part.input) ?? ""
        return [`[Assistant tool call]: ${part.name}(${level >= OUTPUTS_REMOVED ? clip(input) : input})`]
      }
      if (part.type !== "tool-result") return []
      const result = part.result
      const label = result.type === "error" ? "Tool error" : "Tool result"
      if (level >= OUTPUTS_REMOVED) return [`[${label} omitted]`]
      const output =
        result.type === "content"
          ? SessionRecentText.serializeToolContent(result.value)
          : typeof result.value === "string"
            ? result.value
            : (JSON.stringify(result.value) ?? "")
      return [`[${label}]: ${level >= OUTPUTS_CLIPPED ? clip(output) : output}`]
    })
    .join("\n")
}

/** `value` cut to `TRANSCRIPT_CLIP` characters from its start and end, never splitting a surrogate pair. */
const clip = (value: string) => {
  if (value.length <= TRANSCRIPT_CLIP) return value
  const chars = Array.from(value)
  if (chars.length <= TRANSCRIPT_CLIP) return value
  const half = TRANSCRIPT_CLIP / 2
  const omitted = chars.length - TRANSCRIPT_CLIP
  return `${chars.slice(0, half).join("")}\n[… ${omitted} characters omitted …]\n${chars.slice(-half).join("")}`
}

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
  const prompt = estimatePrompt(context)
  return prompt.measured + prompt.estimated
}

/** The prompt size: `measured` is what the provider reported at the latest response, `estimated` is the text since. */
export const estimatePrompt = (context: SessionContext.Loaded) => {
  const anchorIndex = context.messages.findLastIndex((message) => hasMeasuredPrompt(message, context.model.ref))
  const anchor = context.messages[anchorIndex]
  const base = transcript(context, context.messages.slice(Math.max(0, anchorIndex)))
  // TODO: Pass compaction history the runner has already shaped. This and `recentUserMessages` repeat the
  // runner's unsupported-media and image-budget passes; here the image budget only sees images since the anchor,
  // so image-heavy sessions can estimate high.
  const sent = SessionModelRequest.boundImages(
    SessionModelRequest.unsupportedParts(base.messages, context.model.capabilities),
  )
  // The anchor's usage covers its own output, but not its local tool results, which the provider never saw.
  const unmeasured = sent.filter((message) => message.role !== "assistant" || message.id !== anchor?.id)

  if (anchor?.type !== "assistant" || !anchor.tokens)
    return {
      measured: 0,
      estimated: estimateRequest({ system: base.system, tools: context.tools.definitions, messages: unmeasured }),
    }

  const tokens = anchor.tokens
  return {
    measured: tokens.input + tokens.cache.read + tokens.cache.write + tokens.output + tokens.reasoning,
    estimated: unmeasured.reduce((sum, message) => sum + estimateMessage(message), 0),
  }
}

/**
 * The largest request the model takes while leaving room for its reply: `RESERVE_SHARE` of the window, or
 * `RESERVE_MIN` when that is more. A summary request that must be shrunk is aimed at the same size. A window too small
 * to give up `RESERVE_MIN` keeps `RESERVE_SHARE`.
 */
const calculateCeiling = (limit: SessionContext.Loaded["model"]["limit"], buffer: number | undefined) => {
  // Unknown limits are reported as 0. An unknown input limit falls back to the context window; with no window at
  // all, only a provider rejection can limit the request.
  const window = limit.input || limit.context
  if (window <= 0) return Number.POSITIVE_INFINITY
  // A buffer that leaves no room, such as one set for a larger model, is ignored.
  if (buffer !== undefined && buffer < window) return window - buffer
  return window - Math.max(Math.floor(window * RESERVE_SHARE), window >= 2 * RESERVE_MIN ? RESERVE_MIN : 0)
}

/** The largest summary request that leaves `RESERVE_MIN` of the window for the summary. Zero for an unknown window. */
const summaryRoom = (limit: SessionContext.Loaded["model"]["limit"]) =>
  Math.max(0, (limit.input || limit.context) - RESERVE_MIN)

/**
 * Another provider's count may describe a native window this model cannot replay. History then holds the original
 * messages that window stood for, which the count leaves out, so only the current provider's counts are trusted.
 */
const hasMeasuredPrompt = (message: SessionMessage.Info, model: SessionContext.Loaded["model"]["ref"]) =>
  message.type === "assistant" &&
  message.model.providerID === model.providerID &&
  !message.error &&
  message.tokens !== undefined &&
  message.tokens.input + message.tokens.cache.read + message.tokens.cache.write > 0

/**
 * `prepare` sizes the output limit for a request of `budget` tokens, but `deliver` can send a larger one when it
 * cannot shrink the conversation further. Lower the limit to the room the request being sent leaves in the window,
 * so the input and the requested output never exceed the window by our own estimate.
 *
 * The limit leaves the same margin for a low estimate that primary requests do. `deliver` aims at about 90% of the
 * window, so that margin alone would cut a summary near its target to the minimum; there it still gets up to
 * `SUMMARY_OUTPUT_FLOOR` of the room left without the margin.
 */
const fitOutput = (request: LLMRequest, limit: SessionContext.Loaded["model"]["limit"]) => {
  const current = request.generation?.maxTokens
  if (current === undefined) return request
  const estimated = estimateRequest(request)
  const maxTokens = Math.min(
    current,
    Math.max(
      SessionModelRequest.outputLimit(limit, { measured: 0, estimated }),
      Math.min(SUMMARY_OUTPUT_FLOOR, SessionModelRequest.outputLimit(limit, { measured: estimated, estimated: 0 })),
    ),
  )
  if (maxTokens === current) return request
  return LLMRequest.update(request, { generation: { ...request.generation, maxTokens } })
}

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

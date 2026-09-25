export * as SessionCompaction from "./compaction-v2.js"

import { type AIError, isContextOverflowFailure, LLMClient, type LLMRequest } from "@opencode/ai"
import type { StreamOptions } from "@opencode/ai/route"
import type { SessionError } from "@opencode/schema/session-error"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Result } from "effect"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { llmClient } from "../effect/app-node-platform.js"
import { State } from "../state.js"
import type { SessionContext } from "./context.js"
import { SessionEvent } from "./event.js"
import type { SessionMessage } from "./message.js"
import { SessionModelRequest } from "./model-request.js"
import type { SessionProviderContext } from "./provider-context.js"
import { SessionRunnerRetry } from "./runner/retry.js"
import { toSessionError } from "./to-session-error.js"
import type { SessionUsage } from "./usage.js"

export type Settings = {
  auto: boolean
  /** Tokens kept free below the model's limits before compacting. */
  buffer: number
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
  readonly send: (request: LLMRequest, options: StreamOptions) => Effect.Effect<Result, AIError>
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const llm = yield* LLMClient.Service
    const db = (yield* Database.Service).db
    const requests = yield* SessionModelRequest.Service

    const state = State.create<Settings, Editor>({
      name: "session-compaction",
      initial: () => ({ auto: true, buffer: 20_000, keep: 15_000 }),
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
      if (trigger.reason === "auto" && !due(context, settings)) return { status: "skipped" }

      const mechanism = yield* context.model.compaction?.type === "native"
        ? compactNatively(trigger)
        : summarize(trigger, settings)
      const policy = yield* SessionRunnerRetry.policy(context.session.id)
      let request = mechanism.prepared.request

      for (let attempt = 1; ; attempt++) {
        const outcome = yield* Effect.result(mechanism.send(request, mechanism.prepared.options))
        if (Result.isSuccess(outcome)) return yield* publish(trigger, outcome.success)
        const cause = outcome.failure
        const error = toSessionError(cause)

        if (isContextOverflowFailure(cause)) {
          const smaller = shrink(request, attempt)
          if (!smaller) return yield* publish(trigger, { error, overflow: true })
          request = smaller
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

    /** Would sending this context reach the model's ceiling? */
    const due = (context: SessionContext.Loaded, settings: Settings): boolean => {
      throw new Error(`not implemented: due(${context.session.id}, ${settings.auto})`)
    }

    /** The request with less conversation in it, or undefined when nothing more can go. */
    const shrink = (request: LLMRequest, attempt: number): LLMRequest | undefined => {
      throw new Error(`not implemented: shrink(${request.messages.length}, ${attempt})`)
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

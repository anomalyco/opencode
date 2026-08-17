import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AutoSummaryStore } from "@opencode-ai/core/session/auto-summary-store"
import { Database } from "@opencode-ai/core/database/database"
import { PermissionDecisionsStore } from "@opencode-ai/core/session/permission-decisions-store"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { LLMEvent } from "@opencode-ai/llm"
import { Cause, Context, Deferred, Effect, Exit, Layer, Option } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import { SessionAutoSummary } from "@/session/auto-summary"
import { Session } from "@/session/session"
import { MessageID, SessionID } from "@/session/schema"
import { InstanceState } from "@/effect/instance-state"
import { Permission } from "."
import { buildPrompt, parseVerdict, summarize } from "./verdict"

const SUMMARY_TIMEOUT = 20_000
const VALIDATE_TIMEOUT = 15_000
const HEALTH_TIMEOUT = 10_000
const ASK_TIMEOUT = 45_000
const HEALTH_CACHE_TTL = 30_000
// Health runs outside any session: one synthetic id for both the user
// message and the stream keeps telemetry attribution consistent.
const HEALTH_SESSION = "ses_validator_health"

export { parseVerdict }

export interface Health {
  readonly ok: boolean
  readonly model?: string
  readonly reason?: string
}

export interface Interface {
  readonly validate: (
    input: Permission.AutoInput,
  ) => Effect.Effect<Permission.AutoOutcome | undefined, PermissionV1.CorrectedError>
  readonly health: () => Effect.Effect<Health>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PermissionValidator") {}

export interface Options {
  readonly askTimeout?: number
  readonly healthCacheTtl?: number
}

const make = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const askTimeout = options?.askTimeout ?? ASK_TIMEOUT
      const healthCacheTtl = options?.healthCacheTtl ?? HEALTH_CACHE_TTL
      const permission = yield* Permission.Service
      const agents = yield* Agent.Service
      const provider = yield* Provider.Service
      const llm = yield* LLM.Service
      const autoSummary = yield* SessionAutoSummary.Service
      const summaries = yield* AutoSummaryStore.Service
      const decisions = yield* PermissionDecisionsStore.Service
      const database = yield* Database.Service
      const sessions = yield* Session.Service

      // Strict FIFO per session: each validation awaits its predecessor's
      // release before touching the model, so parallel tool calls validate one
      // at a time and audit rows land in arrival order. Runs in the asking
      // fiber — no consumer fiber to keep alive.
      const tails = new Map<string, Effect.Effect<void>>()
      const serial = <A, E>(sessionID: string, work: Effect.Effect<A, E>) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const previous = tails.get(sessionID) ?? Effect.void
            const release = yield* Deferred.make<void>()
            const tail = Deferred.await(release)
            tails.set(sessionID, tail)
            return yield* restore(
              Effect.gen(function* () {
                yield* previous
                return yield* work
              }),
            ).pipe(
              Effect.ensuring(
                Effect.gen(function* () {
                  yield* Deferred.succeed(release, undefined)
                  if (tails.get(sessionID) === tail) tails.delete(sessionID)
                }),
              ),
            )
          }),
        )

      const audit = Effect.fn("PermissionValidator.audit")(function* (
        input: Permission.AutoInput,
        verdict: PermissionDecisionsStore.Verdict,
        model: string,
        latencyMs: number,
        reason?: string,
        prompt?: string,
      ) {
        // The audit trail must never break or block the ask itself — but the
        // caller learns whether the row landed, because an ALLOW without it
        // is an approval without evidence and must degrade to the human flow.
        const outcome = yield* decisions
          .insert({
            sessionID: input.sessionID,
            permission: input.permission,
            patterns: [...input.patterns],
            // callID lets the TUI correlate this row with the tool call in the
            // transcript; it lives inside the metadata JSON, no schema change.
            metadata: input.tool
              ? { ...summarize(input.metadata), callID: input.tool.callID }
              : summarize(input.metadata),
            verdict,
            reason,
            prompt,
            model,
            latencyMs,
          })
          .pipe(Effect.exit)
        if (Exit.isFailure(outcome)) {
          if (Cause.hasInterruptsOnly(outcome.cause)) return yield* Effect.interrupt
          yield* Effect.logWarning("permission decision audit write failed", {
            cause: Cause.pretty(outcome.cause),
          })
          return false
        }
        return true
      })

      const stream = (
        ag: Agent.Info,
        mdl: Provider.Model,
        user: SessionV1.User,
        sessionID: string,
        content: string,
        timeout: number,
      ) =>
        llm
          .stream({
            agent: ag,
            user,
            system: [],
            small: true,
            tools: {},
            model: mdl,
            sessionID,
            retries: 1,
            messages: [{ role: "user", content }],
          })
          .pipe(
            Stream.filter(LLMEvent.is.textDelta),
            Stream.map((event) => event.text),
            Stream.mkString,
            Effect.orDie,
            Effect.timeout(timeout),
          )

      const resolveModel = (ag: Agent.Info, user: SessionV1.User, config?: Session.PermissionValidatorConfig) =>
        Effect.gen(function* () {
          if (config?.mode === "model") {
            const selected = Provider.parseModel(config.model)
            return yield* provider.getModel(selected.providerID, selected.modelID)
          }
          if (ag.model) return yield* provider.getModel(ag.model.providerID, ag.model.modelID)
          const small = yield* provider.getSmallModel(user.model.providerID)
          if (small) return small
          return yield* provider.getModel(user.model.providerID, user.model.modelID)
        })

      const run = Effect.fn("PermissionValidator.run")(function* (input: Permission.AutoInput) {
        const started = Date.now()
        // Catch-up summary gates the first validation after switching a session
        // to "auto"; bounded so a broken summarizer only means validating
        // without a summary, never a stuck ask.
        const session = yield* recover(sessions.get(input.sessionID))
        if (session?.permissionValidator?.mode === "disabled") return undefined
        yield* recover(
          autoSummary.ensure(input.sessionID).pipe(Effect.timeout(SUMMARY_TIMEOUT)),
          "auto summary ensure failed",
        )
        const summary = yield* recover(summaries.get(input.sessionID))
        const user = yield* recover(
          MessageV2.filterCompactedEffect(input.sessionID).pipe(
            Effect.provideService(Database.Service, database),
            Effect.map((msgs) => MessageV2.latest(msgs).user),
          ),
        )
        const ag = yield* recover(agents.get("command-validator"))

        const fallback = Effect.fn("PermissionValidator.fallback")(function* (
          reason: string,
          model: string,
          cause?: Cause.Cause<unknown>,
          prompt?: string,
        ) {
          yield* Effect.logWarning("permission.validator.fallback", {
            reason,
            sessionID: input.sessionID,
            permission: input.permission,
            ...(cause ? { cause: Cause.pretty(cause) } : {}),
          })
          yield* audit(input, "fallback", model, Date.now() - started, reason, prompt)
          return { verdict: "fallback" as const, reason, model }
        })

        if (!ag) return yield* fallback("error", "unknown")
        if (!user) return yield* fallback("error", "unknown")
        const mdl = yield* recover(resolveModel(ag, user, session?.permissionValidator))
        if (!mdl) return yield* fallback("error", "unknown")
        const model = `${mdl.providerID}/${mdl.id}`

        const prompt = buildPrompt(input, summary?.summary)
        if (prompt.truncated) {
          // Never approve over an incomplete view of the request: a
          // destructive suffix past the cap would be invisible to the model.
          yield* audit(input, "uncertain", model, Date.now() - started, "payload truncated")
          return { verdict: "uncertain" as const, reason: "payload truncated", model }
        }

        const attempted = yield* stream(ag, mdl, user, input.sessionID, prompt.text, VALIDATE_TIMEOUT).pipe(Effect.exit)
        if (Exit.isFailure(attempted)) {
          // An interrupted validation must die interrupted (see recover), not
          // degrade into a second fallback audit row.
          if (Cause.hasInterruptsOnly(attempted.cause)) return yield* Effect.interrupt
          const reason = Cause.isTimeoutError(Cause.squash(attempted.cause)) ? "timeout" : "error"
          return yield* fallback(reason, model, attempted.cause, prompt.text)
        }

        const parsed = parseVerdict(attempted.value)
        if (!parsed) return yield* fallback("invalid", model, undefined, prompt.text)
        if (parsed.verdict === "allow") {
          const recorded = yield* audit(input, "allow", model, Date.now() - started, undefined, prompt.text)
          if (recorded) return { verdict: "allow" as const }
          yield* Effect.logWarning("permission.validator.fallback", {
            reason: "audit",
            sessionID: input.sessionID,
            permission: input.permission,
          })
          return { verdict: "fallback" as const, reason: "audit", model }
        }
        if (parsed.verdict === "deny") {
          yield* audit(input, "deny", model, Date.now() - started, parsed.reason, prompt.text)
          return yield* new PermissionV1.CorrectedError({ feedback: parsed.reason })
        }
        yield* audit(input, "uncertain", model, Date.now() - started, parsed.reason, prompt.text)
        return { verdict: "uncertain" as const, reason: parsed.reason, model }
      })

      // Total budget covering the queue wait plus the validation itself:
      // without it, N parallel asks serialize into N×validation-time of
      // invisible spinner with no pending request to show for it. Expiry
      // degrades to the human flow; the serial chain's finalizer releases the
      // tail on interruption, so asks queued behind this one still drain.
      const validate: Interface["validate"] = (input) =>
        Effect.gen(function* () {
          const started = Date.now()
          const outcome = yield* serial(input.sessionID, run(input)).pipe(Effect.timeoutOption(askTimeout))
          if (Option.isSome(outcome)) return outcome.value
          yield* Effect.logWarning("permission.validator.fallback", {
            reason: "timeout",
            sessionID: input.sessionID,
            permission: input.permission,
          })
          // The deadline already fired; auditing inline would extend it.
          // Fire and forget — best-effort row, the human flow is decided.
          yield* Effect.forkDetach(audit(input, "fallback", "unknown", Date.now() - started, "timeout"))
          return { verdict: "fallback" as const, reason: "timeout", model: "unknown" }
        })

      // Health probes cost a small-model call; the last result rides a short
      // in-memory cache per instance+model so polling the route doesn't
      // spend one call per request.
      const healthCache = new Map<string, { at: number; value: Health }>()

      const health = Effect.fn("PermissionValidator.health")(function* () {
        const directory = yield* InstanceState.directory
        const ag = yield* recover(agents.get("command-validator"))
        if (!ag) return { ok: false, reason: "command-validator agent not registered" }
        const mdl = yield* recover(
          Effect.gen(function* () {
            if (ag.model) return yield* provider.getModel(ag.model.providerID, ag.model.modelID)
            const fallback = yield* provider.defaultModel()
            const small = yield* provider.getSmallModel(fallback.providerID)
            if (small) return small
            return yield* provider.getModel(fallback.providerID, fallback.modelID)
          }),
        )
        if (!mdl) return { ok: false, reason: "could not resolve a model for command-validator" }
        const model = `${mdl.providerID}/${mdl.id}`
        const key = `${directory} ${model}`
        const cached = healthCache.get(key)
        if (cached && Date.now() - cached.at < healthCacheTtl) return cached.value
        // Health runs outside any session: a synthetic user message satisfies
        // the stream input contract without touching session storage. The
        // probe replays a real, trivially safe validation prompt and demands
        // a parseable verdict — an empty or garbage stream used to read as
        // healthy.
        const user: SessionV1.User = {
          id: MessageID.ascending(),
          role: "user",
          sessionID: SessionID.make(HEALTH_SESSION),
          agent: ag.name,
          model: { providerID: mdl.providerID, modelID: mdl.id },
          time: { created: Date.now() },
        }
        const ping = yield* stream(
          ag,
          mdl,
          user,
          HEALTH_SESSION,
          buildPrompt({ permission: "bash", patterns: ["ls"], metadata: { command: "ls" } }, "(health probe)").text,
          HEALTH_TIMEOUT,
        ).pipe(Effect.exit)
        const value = verdictOf(model, ping)
        healthCache.set(key, { at: Date.now(), value })
        return value
      })

      yield* permission.registerValidator(validate)
      return Service.of({ validate, health })
    }),
  )

// Recover a failed gate or probe to undefined, but never swallow an
// interrupt: the ask deadline and layer shutdown tear the validation fiber
// down by interrupting it, and a swallowed interrupt would leave an expired
// ask holding its queue tail.
function recover<A, E, R>(self: Effect.Effect<A, E, R>, message?: string): Effect.Effect<A | undefined, never, R> {
  return self.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
      if (!message) return Effect.succeed(undefined)
      return Effect.logWarning(message, { cause: Cause.pretty(cause) }).pipe(Effect.as(undefined))
    }),
  )
}

function verdictOf(model: string, ping: Exit.Exit<string, unknown>): Health {
  if (Exit.isFailure(ping)) {
    const squashed = Cause.squash(ping.cause)
    return { ok: false, model, reason: squashed instanceof Error ? squashed.message : "unreachable" }
  }
  if (!parseVerdict(ping.value)) return { ok: false, model, reason: "unparseable verdict" }
  return { ok: true, model }
}

const deps = [
  Permission.node,
  Agent.node,
  Provider.node,
  LLM.node,
  SessionAutoSummary.node,
  AutoSummaryStore.node,
  PermissionDecisionsStore.node,
  Database.node,
  Session.node,
] as const

export const node = LayerNode.make({ service: Service, layer: make(), deps })

// Same node with bounded waits, for tests that exercise the ask deadline or
// the health cache without sitting through production timeouts.
export const nodeWith = (options: Options) => LayerNode.make({ service: Service, layer: make(options), deps })

export * as PermissionValidator from "./validator"

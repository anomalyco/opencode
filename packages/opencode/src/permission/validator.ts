import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { AutoSummaryStore } from "@opencode-ai/core/session/auto-summary-store"
import { Database } from "@opencode-ai/core/database/database"
import { PermissionDecisionsStore } from "@opencode-ai/core/session/permission-decisions-store"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { LLMEvent } from "@opencode-ai/llm"
import { Cause, Context, Deferred, Effect, Exit, Layer } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import { SessionAutoSummary } from "@/session/auto-summary"
import { MessageID, SessionID } from "@/session/schema"
import { Permission } from "."
import { buildPrompt, parseVerdict } from "./verdict"

const SUMMARY_TIMEOUT = 20_000
const VALIDATE_TIMEOUT = 15_000
const HEALTH_TIMEOUT = 10_000

export { parseVerdict }

export interface Health {
  readonly ok: boolean
  readonly model?: string
  readonly reason?: string
}

export interface Interface {
  readonly validate: (input: Permission.AutoInput) => Effect.Effect<Permission.AutoOutcome, PermissionV1.CorrectedError>
  readonly health: () => Effect.Effect<Health>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/PermissionValidator") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const autoSummary = yield* SessionAutoSummary.Service
    const summaries = yield* AutoSummaryStore.Service
    const decisions = yield* PermissionDecisionsStore.Service
    const database = yield* Database.Service

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
    ) {
      yield* decisions
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
          model,
          latencyMs,
        })
        .pipe(
          // The audit trail must never break or block the ask itself.
          Effect.catchCause((cause) =>
            Effect.logWarning("permission decision audit write failed", { cause: Cause.pretty(cause) }),
          ),
        )
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

    const resolveModel = (ag: Agent.Info, user: SessionV1.User) =>
      Effect.gen(function* () {
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
      yield* autoSummary.ensure(input.sessionID).pipe(
        Effect.timeout(SUMMARY_TIMEOUT),
        Effect.catchCause((cause) => Effect.logWarning("auto summary ensure failed", { cause: Cause.pretty(cause) })),
      )
      const summary = yield* summaries.get(input.sessionID).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      const user = yield* MessageV2.filterCompactedEffect(input.sessionID).pipe(
        Effect.provideService(Database.Service, database),
        Effect.map((msgs) => MessageV2.latest(msgs).user),
        Effect.catchCause(() => Effect.succeed(undefined)),
      )
      const ag = yield* agents.get("command-validator").pipe(Effect.catchCause(() => Effect.succeed(undefined)))

      const fallback = Effect.fn("PermissionValidator.fallback")(function* (
        reason: string,
        model: string,
        cause?: Cause.Cause<unknown>,
      ) {
        yield* Effect.logWarning("permission.validator.fallback", {
          reason,
          sessionID: input.sessionID,
          permission: input.permission,
          ...(cause ? { cause: Cause.pretty(cause) } : {}),
        })
        yield* audit(input, "fallback", model, Date.now() - started, reason)
        return { verdict: "fallback" as const, reason, model }
      })

      if (!ag) return yield* fallback("error", "unknown")
      if (!user) return yield* fallback("error", "unknown")
      const mdl = yield* resolveModel(ag, user).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      if (!mdl) return yield* fallback("error", "unknown")
      const model = `${mdl.providerID}/${mdl.id}`

      const attempted = yield* stream(
        ag,
        mdl,
        user,
        input.sessionID,
        buildPrompt(input, summary?.summary),
        VALIDATE_TIMEOUT,
      ).pipe(Effect.exit)
      if (Exit.isFailure(attempted)) {
        const reason = Cause.isTimeoutError(Cause.squash(attempted.cause)) ? "timeout" : "error"
        return yield* fallback(reason, model, attempted.cause)
      }

      const parsed = parseVerdict(attempted.value)
      if (!parsed) return yield* fallback("invalid", model)
      if (parsed.verdict === "allow") {
        yield* audit(input, "allow", model, Date.now() - started)
        return { verdict: "allow" as const }
      }
      if (parsed.verdict === "deny") {
        yield* audit(input, "deny", model, Date.now() - started, parsed.reason)
        return yield* new PermissionV1.CorrectedError({ feedback: parsed.reason })
      }
      yield* audit(input, "uncertain", model, Date.now() - started, parsed.reason)
      return { verdict: "uncertain" as const, reason: parsed.reason, model }
    })

    const validate: Interface["validate"] = (input) => serial(input.sessionID, run(input))

    const health = Effect.fn("PermissionValidator.health")(function* () {
      const ag = yield* agents.get("command-validator").pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      if (!ag) return { ok: false, reason: "command-validator agent not registered" }
      const mdl = yield* Effect.gen(function* () {
        if (ag.model) return yield* provider.getModel(ag.model.providerID, ag.model.modelID)
        const fallback = yield* provider.defaultModel()
        const small = yield* provider.getSmallModel(fallback.providerID)
        if (small) return small
        return yield* provider.getModel(fallback.providerID, fallback.modelID)
      }).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      if (!mdl) return { ok: false, reason: "could not resolve a model for command-validator" }
      const model = `${mdl.providerID}/${mdl.id}`
      // Health runs outside any session: a synthetic user message satisfies
      // the stream input contract without touching session storage.
      const user: SessionV1.User = {
        id: MessageID.ascending(),
        role: "user",
        sessionID: SessionID.make("ses_validator_health"),
        agent: ag.name,
        model: { providerID: mdl.providerID, modelID: mdl.id },
        time: { created: Date.now() },
      }
      const ping = yield* stream(ag, mdl, user, "validator-health", "Reply ALLOW", HEALTH_TIMEOUT).pipe(Effect.exit)
      if (Exit.isFailure(ping)) {
        const squashed = Cause.squash(ping.cause)
        return { ok: false, model, reason: squashed instanceof Error ? squashed.message : "unreachable" }
      }
      return { ok: true, model }
    })

    yield* permission.registerValidator(validate)
    return Service.of({ validate, health })
  }),
)

// Metadata travels with the audit row; cap long values so a huge diff or
// command doesn't bloat the table.
function summarize(metadata: Record<string, unknown>) {
  const entries = Object.entries(metadata)
  if (entries.length === 0) return undefined
  return Object.fromEntries(
    entries.map(([key, value]) => [
      key,
      typeof value === "string" && value.length > 500 ? value.slice(0, 500) + "…" : value,
    ]),
  )
}

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [
    Permission.node,
    Agent.node,
    Provider.node,
    LLM.node,
    SessionAutoSummary.node,
    AutoSummaryStore.node,
    PermissionDecisionsStore.node,
    Database.node,
  ],
})

export * as PermissionValidator from "./validator"

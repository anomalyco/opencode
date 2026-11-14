import { describe, expect } from "bun:test"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols/openai-chat"
import { Cause, Effect, Exit, Layer } from "effect"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Model as ModelSchema } from "@opencode/schema/model"
import { ModelAvailability } from "@opencode/core/model-availability"
import { ModelResolver } from "@opencode/core/model-resolver"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionSchema } from "@opencode/core/session/schema"
import { it } from "./lib/effect"

const UTC = (day: number, hour: number) => new Date(Date.UTC(2026, 10, 8 + day, hour))
// 2026-11-08 is a Sunday; day 1 = Monday.

function modelInfo(providerID: string, id: string, availability?: ModelSchema.Availability): Model.Info {
  return {
    ...Model.Info.default(providerID as never, id as never),
    ...(availability === undefined ? {} : { availability }),
  }
}

/** Blocks the model all day, every day. */
const ALWAYS_BLOCKED: ModelSchema.Availability = { windows: [{ start: "00:00", end: "23:59" }] }
/** Blocks the model on Monday 00:00–23:59 UTC only. */
const BLOCKED_MONDAY: ModelSchema.Availability = {
  windows: [{ days: ["mon"], start: "00:00", end: "23:59" }],
}

const languageModel = (provider: string, id: string) =>
  LanguageModel.make({ id, provider, route: OpenAIChat.route })

/** Builds a self-contained layer for one test: no state is shared between tests. */
const testLayer = (options: {
  readonly agentModel?: { readonly providerID: string; readonly id: string }
  readonly resolverFallback?: Model.Info
  /** When set, the `experimental.model.resolve` hook returns this model instead of the input. */
  readonly hookModel?: { readonly providerID: string; readonly id: string; readonly variant?: string }
}) => {
  const stubResolver = Layer.succeed(
    ModelResolver.Service,
    ModelResolver.Service.of({
      resolve: (model: Model.Ref) => {
        const info = modelInfo(model.providerID, model.id)
        return Effect.succeed(
          SessionRunnerModel.resolved(languageModel(model.providerID, model.id), {
            capabilities: info.capabilities,
            cost: info.cost,
            limit: info.limit,
            ...(model.variant === undefined ? {} : { variant: model.variant }),
          }),
        )
      },
      fallback: () => Effect.succeed(options.resolverFallback),
      resolveModel: (info: Model.Info, variant?: Model.VariantID) =>
        Effect.succeed(
          SessionRunnerModel.resolved(languageModel(info.providerID, info.id), {
            capabilities: info.capabilities,
            cost: info.cost,
            limit: info.limit,
            ...(variant === undefined ? {} : { variant }),
          }),
        ),
      resolveImage: () => Effect.succeed(undefined),
      resolveDecision: () => Effect.succeed(undefined),
    } as never),
  )
  const stubAgents = Layer.succeed(
    Agent.Service,
    Agent.Service.of({
      select: () =>
        Effect.succeed({
          info: options.agentModel === undefined ? undefined : { model: options.agentModel },
        }),
    } as never),
  )
  const stubHooks = Layer.succeed(
    PluginHooks.Service,
    PluginHooks.Service.of({
      trigger: (_domain: never, _name: never, event: never) =>
        Effect.succeed(
          options.hookModel === undefined
            ? event
            : {
                ...(event as object),
                model: {
                  providerID: options.hookModel.providerID,
                  id: options.hookModel.id,
                  variant: options.hookModel.variant,
                },
              },
        ),
    } as never),
  )
  return Layer.provide(SessionRunnerModel.layer, Layer.mergeAll(stubResolver, stubAgents, stubHooks))
}

const session = (model?: { readonly providerID: string; readonly id: string; readonly variant?: string }) =>
  ({
    id: SessionSchema.ID.make("session"),
    directory: "/tmp",
    ...(model === undefined ? {} : { model: { providerID: model.providerID, id: model.id, ...(model.variant === undefined ? {} : { variant: model.variant }) } }),
  }) as never

const resolveSelection = (
  catalog: readonly Model.Info[],
  sessionModel: { readonly providerID: string; readonly id: string; readonly variant?: string } | undefined,
  at: Date,
  layer: Layer.Layer<SessionRunnerModel.Service> = testLayer({}),
): Effect.Effect<Exit.Exit<ModelResolver.Resolved, unknown>, never, never> =>
  Effect.gen(function* () {
    const service = yield* SessionRunnerModel.Service
    return yield* service.resolve(session(sessionModel), () => Effect.succeed(catalog), {
      kind: "prompt" as never,
      agent: "build" as never,
    })
  }).pipe(Effect.provide(layer), Effect.provide(ModelAvailability.Now.at(at)), Effect.exit)

const blockedReason = (exit: Exit.Exit<ModelResolver.Resolved, unknown>): string | undefined => {
  if (Exit.isSuccess(exit)) return undefined
  const error = Cause.findErrorOption(exit.cause)
  if (error?._tag !== "Some" || !(error.value instanceof SessionRunnerModel.ModelBlockedByAvailabilityError)) return undefined
  return error.value.reason
}

describe("SessionRunnerModel availability fallback", () => {
  it.effect("returns the selected model when available", () =>
    Effect.gen(function* () {
      const exit = yield* resolveSelection(
        [modelInfo("deepseek", "chat", BLOCKED_MONDAY)],
        { providerID: "deepseek", id: "chat" },
        UTC(0, 12), // Sunday — unblocked.
      )
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
  )

  it.effect("substitutes the configured fallback while blocked", () =>
    Effect.gen(function* () {
      const primary = { ...modelInfo("deepseek", "chat", { ...ALWAYS_BLOCKED, fallback: "anthropic/claude" }) }
      const fallback = modelInfo("anthropic", "claude")
      const result = yield* resolveSelection([primary, fallback], { providerID: "deepseek", id: "chat" }, UTC(1, 12))
      const ref = Exit.isSuccess(result) ? result.value.ref : undefined
      expect(ref && `${ref.providerID}/${ref.id}`).toBe("anthropic/claude")
    }),
  )

  it.effect("follows transitive fallbacks", () =>
    Effect.gen(function* () {
      const first = modelInfo("deepseek", "chat", { ...ALWAYS_BLOCKED, fallback: "openai/gpt" })
      const second = modelInfo("openai", "gpt", { ...ALWAYS_BLOCKED, fallback: "anthropic/claude" })
      const third = modelInfo("anthropic", "claude")
      const result = yield* resolveSelection([first, second, third], { providerID: "deepseek", id: "chat" }, UTC(1, 12))
      const ref = Exit.isSuccess(result) ? result.value.ref : undefined
      expect(ref && `${ref.providerID}`).toBe("anthropic")
    }),
  )

  it.effect("fails with reason no-fallback when no fallback is configured", () =>
    Effect.gen(function* () {
      const exit = yield* resolveSelection(
        [modelInfo("deepseek", "chat", ALWAYS_BLOCKED)],
        { providerID: "deepseek", id: "chat" },
        UTC(1, 12),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      expect(blockedReason(exit)).toBe("no-fallback")
    }),
  )

  it.effect("fails with reason fallback-not-found when the fallback model is not in the catalog", () =>
    Effect.gen(function* () {
      const primary = modelInfo("deepseek", "chat", { ...ALWAYS_BLOCKED, fallback: "anthropic/claude" })
      const exit = yield* resolveSelection([primary], { providerID: "deepseek", id: "chat" }, UTC(1, 12))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(blockedReason(exit)).toBe("fallback-not-found")
    }),
  )

  it.effect("fails with reason cycle-detected on a fallback cycle", () =>
    Effect.gen(function* () {
      // a → b → a: a short cycle.
      const cycle = [
        modelInfo("p", "a", { ...ALWAYS_BLOCKED, fallback: "p/b" }),
        modelInfo("p", "b", { ...ALWAYS_BLOCKED, fallback: "p/a" }),
      ]
      const exit = yield* resolveSelection(cycle, { providerID: "p", id: "a" }, UTC(1, 12))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(blockedReason(exit)).toBe("cycle-detected")
    }),
  )

  it.effect("fails with reason depth-exceeded on an acyclic chain longer than the hop limit", () =>
    Effect.gen(function* () {
      // a → b → c → d → e: five blocked models, more than the three-hop limit, no cycle.
      const chain = [
        modelInfo("p", "a", { ...ALWAYS_BLOCKED, fallback: "p/b" }),
        modelInfo("p", "b", { ...ALWAYS_BLOCKED, fallback: "p/c" }),
        modelInfo("p", "c", { ...ALWAYS_BLOCKED, fallback: "p/d" }),
        modelInfo("p", "d", { ...ALWAYS_BLOCKED, fallback: "p/e" }),
        modelInfo("p", "e"),
      ]
      const exit = yield* resolveSelection(chain, { providerID: "p", id: "a" }, UTC(1, 12))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(blockedReason(exit)).toBe("depth-exceeded")
      const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : undefined
      expect(error?._tag === "Some" && error.value instanceof SessionRunnerModel.ModelBlockedByAvailabilityError
      // The error names the model whose chain hit the cap (p/d after a→b→c→d) and the actual limit.
        ? error.value.message : "").toBe("Model p/d is outside its availability window and its fallback chain exceeds the maximum of 3 hops")
    }),
  )

  it.effect("applies availability to the agent default model, not just session-pinned models", () =>
    Effect.gen(function* () {
      const primary = modelInfo("deepseek", "chat", { ...ALWAYS_BLOCKED, fallback: "anthropic/claude" })
      const fallback = modelInfo("anthropic", "claude")
      const layer = testLayer({ agentModel: { providerID: "deepseek", id: "chat" } })
      const result = yield* resolveSelection([primary, fallback], undefined, UTC(1, 12), layer)
      const ref = Exit.isSuccess(result) ? result.value.ref : undefined
      expect(ref && `${ref.providerID}/${ref.id}`).toBe("anthropic/claude")
    }),
  )

  it.effect("applies availability to the resolver fallback model", () =>
    Effect.gen(function* () {
      const primary = modelInfo("deepseek", "chat", { ...ALWAYS_BLOCKED, fallback: "anthropic/claude" })
      const fallback = modelInfo("anthropic", "claude")
      const layer = testLayer({ resolverFallback: primary })
      const result = yield* resolveSelection([primary, fallback], undefined, UTC(1, 12), layer)
      const ref = Exit.isSuccess(result) ? result.value.ref : undefined
      expect(ref && `${ref.providerID}/${ref.id}`).toBe("anthropic/claude")
    }),
  )

  it.effect("fails with reason malformed-fallback on a malformed fallback ref", () =>
    Effect.gen(function* () {
      const primary = modelInfo("deepseek", "chat", { ...ALWAYS_BLOCKED, fallback: "not-a-ref" })
      const result = yield* resolveSelection([primary], {
        providerID: "deepseek",
        id: "chat",
      }, UTC(1, 12))
      expect(Exit.isFailure(result)).toBe(true)
      expect(blockedReason(result)).toBe("malformed-fallback")
    }),
  )

  it.effect("ignores a hook override that picks a time-blocked model", () =>
    Effect.gen(function* () {
      const primary = modelInfo("deepseek", "chat", { ...ALWAYS_BLOCKED, fallback: "anthropic/claude" })
      const fallback = modelInfo("anthropic", "claude")
      // The hook redirects to another blocked model; the availability-approved fallback must win.
      const hookTarget = modelInfo("openai", "gpt", ALWAYS_BLOCKED)
      const layer = testLayer({ hookModel: { providerID: "openai", id: "gpt" } })
      const result = yield* resolveSelection([primary, fallback, hookTarget], { providerID: "deepseek", id: "chat" }, UTC(1, 12), layer)
      const ref = Exit.isSuccess(result) ? result.value.ref : undefined
      expect(ref && `${ref.providerID}/${ref.id}`).toBe("anthropic/claude")
    }),
  )

  it.effect("honors a hook override that picks an allowed model", () =>
    Effect.gen(function* () {
      const primary = modelInfo("deepseek", "chat", { ...ALWAYS_BLOCKED, fallback: "anthropic/claude" })
      const fallback = modelInfo("anthropic", "claude")
      // Hook overrides stay on the selection's provider; pick another allowed model there.
      const allowed = modelInfo("anthropic", "other")
      const layer = testLayer({ hookModel: { providerID: "anthropic", id: "other" } })
      const result = yield* resolveSelection([primary, fallback, allowed], { providerID: "deepseek", id: "chat" }, UTC(1, 12), layer)
      const ref = Exit.isSuccess(result) ? result.value.ref : undefined
      expect(ref && `${ref.providerID}/${ref.id}`).toBe("anthropic/other")
    }),
  )

  it.effect("resolves a #variant fallback ref through the runner", () =>
    Effect.gen(function* () {
      const primary = modelInfo("deepseek", "chat", { ...ALWAYS_BLOCKED, fallback: "anthropic/claude#fast" })
      const fallback = modelInfo("anthropic", "claude")
      const result = yield* resolveSelection([primary, fallback], { providerID: "deepseek", id: "chat" }, UTC(1, 12))
      const ref = Exit.isSuccess(result) ? result.value.ref : undefined
      expect(ref && `${ref.providerID}/${ref.id}`).toBe("anthropic/claude")
      expect(ref && ref.variant).toBe("fast" as never)
    }),
  )
})

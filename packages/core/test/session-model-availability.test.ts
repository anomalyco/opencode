import { expect } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { Agent } from "@opencode/core/agent"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { ModelAvailability } from "@opencode/core/model-availability"
import { ModelResolver } from "@opencode/core/model-resolver"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/schema/session"
import { Money } from "@opencode/schema/money"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(
  SessionRunnerModel.layer.pipe(
    Layer.provideMerge(ModelResolver.layer.pipe(Layer.provideMerge(PluginTestLayer))),
    Layer.provide(ModelAvailability.Now.at(new Date("2026-11-09T12:00:00Z"))),
  ),
)

function model(ref: string, availability?: Model.Info["availability"]) {
  const parsed = Model.Ref.parse(ref)
  return { ...Model.Info.default(parsed.providerID, parsed.id), availability }
}

function blocked(ref: string, fallback?: string) {
  return model(ref, { windows: [{ start: "00:00", end: "00:00" }], fallback })
}

const install = Effect.fn(function* (...models: Model.Info[]) {
  const providers = yield* Provider.Service
  yield* providers.transform((editor) => {
    for (const info of models) {
      editor.update(info.providerID, (provider) => {
        provider.package = "@opencode/ai/providers/openai"
      })
      editor.models.update(info.providerID, info.id, (entry) => Object.assign(entry, structuredClone(info)))
    }
  })
})

const resolve = Effect.fn(function* (selected: Model.Info) {
  const runner = yield* SessionRunnerModel.Service
  const models = yield* Model.Service
  const location = yield* Location.Service
  return yield* runner.resolve(
    Session.Info.make({
      id: Session.ID.make("ses_availability"),
      projectID: Project.ID.global,
      model: Model.Ref.make({ providerID: selected.providerID, id: selected.id }),
      cost: Money.USD.zero,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
      location: Location.Ref.make({ directory: location.directory }),
    }),
    models.available,
    { kind: "primary", agent: Agent.ID.make("build") },
  )
})

it.live("uses the configured fallback across providers", () =>
  Effect.gen(function* () {
    const primary = blocked("source/a", "fallback/b")
    yield* install(primary, model("fallback/b"))
    expect((yield* resolve(primary)).ref).toEqual(Model.Ref.parse("fallback/b"))
  }),
)

it.live("follows a chain of blocked models to an available fallback", () =>
  Effect.gen(function* () {
    const primary = blocked("source/a", "source/b")
    yield* install(primary, blocked("source/b", "fallback/c"), model("fallback/c"))
    expect((yield* resolve(primary)).ref).toEqual(Model.Ref.parse("fallback/c"))
  }),
)

it.live("reports a cycle in the fallback chain", () =>
  Effect.gen(function* () {
    const primary = blocked("source/a", "source/b")
    yield* install(primary, blocked("source/b", "source/a"))
    expect(yield* resolve(primary).pipe(Effect.flip)).toMatchObject({
      _tag: "SessionRunnerModel.ModelBlockedByAvailabilityError",
      reason: "cycle-detected",
    })
  }),
)

it.live("reports a blocked model with no fallback", () =>
  Effect.gen(function* () {
    const primary = blocked("source/a")
    yield* install(primary)
    expect(yield* resolve(primary).pipe(Effect.flip)).toMatchObject({
      _tag: "SessionRunnerModel.ModelBlockedByAvailabilityError",
      reason: "no-fallback",
    })
  }),
)

it.live("rejects a blocked hook override even when hidden from the picker", () =>
  Effect.gen(function* () {
    const primary = blocked("source/a", "fallback/b")
    const hidden = { ...blocked("fallback/hidden"), enabled: false }
    yield* install(primary, model("fallback/b"), hidden)
    const models = yield* Model.Service
    expect((yield* models.available()).some((entry) => entry.id === hidden.id)).toBe(false)
    expect(yield* models.get(hidden.providerID, hidden.id)).toBeDefined()
    const hooks = yield* PluginHooks.Service
    yield* hooks.register("session", "experimental.model.resolve", (event) =>
      Effect.sync(() => {
        event.model = Model.Ref.parse("fallback/hidden")
      }),
    )
    expect((yield* resolve(primary)).ref).toEqual(Model.Ref.parse("fallback/b"))

    // The same hook wins once its hidden target is available.
    yield* install({ ...hidden, availability: undefined })
    expect((yield* resolve(primary)).ref).toEqual(Model.Ref.parse("fallback/hidden"))
  }),
)

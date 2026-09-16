import { expect } from "bun:test"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { OpenCodeTools } from "@opencode/core/tool/plugin/opencode"
import { Model } from "@opencode/schema/model"
import { Effect } from "effect"
import { testEffect } from "./lib/effect"
import { executeTool, toolIdentity } from "./lib/tool"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)

const alpha = { id: "test/alpha", name: "Alpha", released: 300, variants: ["fast"], cost: [], status: "beta" }
const beta = { id: "other/beta", name: "Beta", released: 200, variants: [], cost: [], status: "active" }
const gamma = { id: "other/gamma", name: "Gamma Flash", released: 100, variants: [], cost: [], status: "active" }
const gammaOld = {
  id: "other/gamma-old",
  name: "Gamma Flash Old",
  released: 50,
  variants: [],
  cost: [],
  status: "active",
}

it.effect("groups available models by provider with paging", () =>
  Effect.gen(function* () {
    const catalog = yield* Provider.Service
    const plugins = yield* Plugin.Service
    const sessions = yield* Session.Service
    const location = yield* Location.Service
    const pluginHost = yield* PluginHost.make(plugins)
    yield* catalog.transform((editor) => {
      editor.update(Provider.ID.make("other"), (provider) => {
        provider.name = "Other Provider"
      })
      editor.models.update(Provider.ID.make("test"), Model.ID.make("alpha"), (model) => {
        model.name = "Alpha"
        model.time.released = 300
        model.variants = [{ id: Model.VariantID.make("fast") }]
        model.status = "beta"
      })
      editor.models.update(Provider.ID.make("other"), Model.ID.make("beta"), (model) => {
        model.name = "Beta"
        model.time.released = 200
      })
      editor.models.update(Provider.ID.make("other"), Model.ID.make("gamma"), (model) => {
        model.name = "Gamma Flash"
        model.time.released = 100
        model.family = Model.Family.make("gamma")
      })
      editor.models.update(Provider.ID.make("other"), Model.ID.make("gamma-old"), (model) => {
        model.name = "Gamma Flash Old"
        model.time.released = 50
        model.family = Model.Family.make("gamma")
      })
      editor.models.update(Provider.ID.make("other"), Model.ID.make("disabled"), (model) => {
        model.time.released = 400
        model.enabled = false
      })
    })
    yield* OpenCodeTools.Plugin.effect(pluginHost)
    // The caller runs on `test`, which sorts first despite `other` coming earlier alphabetically.
    const session = yield* sessions.create({
      location: Location.Ref.make({ directory: location.directory }),
      model: Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("alpha") }),
    })
    const registry = yield* Tool.Service
    const run = (input: Record<string, unknown>) =>
      executeTool(registry, {
        sessionID: session.id,
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: `call-${JSON.stringify(input)}`,
          name: "execute",
          input: { code: `return await tools.opencode.models(${JSON.stringify(input)})` },
        },
      }).pipe(Effect.map((result) => JSON.parse(result.content?.[0]?.type === "text" ? result.content[0].text : "")))

    // Grouped by provider, newest first within each, disabled models excluded.
    expect(yield* run({})).toEqual({
      providers: [
        { id: "test", name: "test", models: [alpha] },
        { id: "other", name: "Other Provider", models: [beta, gamma] },
      ],
      total: 3,
      next: null,
    })

    // Paging slices the ordered list, so a page can end inside a provider group.
    expect(yield* run({ limit: 2 })).toEqual({
      providers: [
        { id: "test", name: "test", models: [alpha] },
        { id: "other", name: "Other Provider", models: [beta] },
      ],
      total: 3,
      next: 2,
    })
    expect(yield* run({ limit: 2, offset: 2 })).toEqual({
      providers: [{ id: "other", name: "Other Provider", models: [gamma] }],
      total: 3,
      next: null,
    })

    expect(yield* run({ provider: "other provider" })).toMatchObject({ total: 2, providers: [{ id: "other" }] })
    expect(yield* run({ provider: "test" })).toEqual({
      providers: [{ id: "test", name: "test", models: [alpha] }],
      total: 1,
      next: null,
    })

    // Every word of the query must appear somewhere in the reference or display name, ignoring case.
    expect(yield* run({ query: "GAMMA" })).toEqual({
      providers: [{ id: "other", name: "Other Provider", models: [gamma] }],
      total: 1,
      next: null,
    })
    expect(yield* run({ query: "test/" })).toMatchObject({ total: 1, providers: [{ id: "test" }] })
    expect(yield* run({ query: "other flash" })).toMatchObject({ total: 1, providers: [{ models: [gamma] }] })
    expect(yield* run({ query: "gamma beta" })).toEqual({ providers: [], total: 0, next: null })

    // Only the newest model of each family is listed unless `all` is set; the query is applied first.
    expect(yield* run({ all: true })).toMatchObject({
      total: 4,
      providers: [{ id: "test" }, { id: "other", models: [beta, gamma, gammaOld] }],
    })
    expect(yield* run({ query: "old" })).toMatchObject({ total: 1, providers: [{ models: [gammaOld] }] })
    expect(yield* run({ provider: "other", query: "alpha" })).toEqual({ providers: [], total: 0, next: null })
  }),
)

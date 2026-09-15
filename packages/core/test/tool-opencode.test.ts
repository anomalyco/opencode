import { expect } from "bun:test"
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

it.effect("lists available models newest first with paging", () =>
  Effect.gen(function* () {
    const catalog = yield* Provider.Service
    const plugins = yield* Plugin.Service
    const pluginHost = yield* PluginHost.make(plugins)
    yield* catalog.transform((editor) => {
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
        model.name = "Gamma"
        model.time.released = 100
      })
      editor.models.update(Provider.ID.make("other"), Model.ID.make("disabled"), (model) => {
        model.time.released = 400
        model.enabled = false
      })
    })
    yield* OpenCodeTools.Plugin.effect(pluginHost)
    const registry = yield* Tool.Service
    const run = (input: Record<string, unknown>) =>
      executeTool(registry, {
        sessionID: Session.ID.make("ses_tool_opencode"),
        ...toolIdentity,
        call: {
          type: "tool-call",
          id: `call-${JSON.stringify(input)}`,
          name: "execute",
          input: { code: `return await tools.opencode.models(${JSON.stringify(input)})` },
        },
      }).pipe(Effect.map((result) => JSON.parse(result.content?.[0]?.type === "text" ? result.content[0].text : "")))

    // Newest first, disabled models excluded, and the full agent-facing shape.
    expect(yield* run({})).toEqual({
      models: [
        {
          id: "test/alpha",
          name: "Alpha",
          released: 300,
          variants: ["fast"],
          cost: [],
          status: "beta",
        },
        {
          id: "other/beta",
          name: "Beta",
          released: 200,
          variants: [],
          cost: [],
          status: "active",
        },
        {
          id: "other/gamma",
          name: "Gamma",
          released: 100,
          variants: [],
          cost: [],
          status: "active",
        },
      ],
      total: 3,
      next: null,
    })

    const first = yield* run({ limit: 2 })
    expect(first.models.map((model: { id: string }) => model.id)).toEqual(["test/alpha", "other/beta"])
    expect(first).toMatchObject({ total: 3, next: 2 })
    const second = yield* run({ limit: 2, offset: 2 })
    expect(second.models.map((model: { id: string }) => model.id)).toEqual(["other/gamma"])
    expect(second).toMatchObject({ total: 3, next: null })

    const filtered = yield* run({ provider: "other" })
    expect(filtered.models.map((model: { id: string }) => model.id)).toEqual(["other/beta", "other/gamma"])
    expect(filtered).toMatchObject({ total: 2, next: null })
  }),
)

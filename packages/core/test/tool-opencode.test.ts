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

it.effect("lists available models through the opencode namespace", () =>
  Effect.gen(function* () {
    const catalog = yield* Provider.Service
    const plugins = yield* Plugin.Service
    const pluginHost = yield* PluginHost.make(plugins)
    yield* catalog.transform((editor) => {
      editor.models.update(Provider.ID.make("test"), Model.ID.make("alpha"), (model) => {
        model.name = "Alpha"
        model.variants = [{ id: Model.VariantID.make("fast") }]
      })
      editor.models.update(Provider.ID.make("other"), Model.ID.make("beta"), (model) => {
        model.name = "Beta"
      })
      editor.models.update(Provider.ID.make("other"), Model.ID.make("disabled"), (model) => {
        model.enabled = false
      })
    })
    yield* OpenCodeTools.Plugin.effect(pluginHost)
    const registry = yield* Tool.Service
    const run = (code: string) =>
      executeTool(registry, {
        sessionID: Session.ID.make("ses_tool_opencode"),
        ...toolIdentity,
        call: { type: "tool-call", id: `call-${code.length}`, name: "execute", input: { code } },
      })

    const all = yield* run(
      "const list = await tools.opencode.models({}); return list.models.map((model) => `${model.providerID}/${model.id}: ${model.name} [${model.variants.map((variant) => variant.id)}]`).sort()",
    )
    expect(all.content).toEqual([
      { type: "text", text: JSON.stringify(["other/beta: Beta []", "test/alpha: Alpha [fast]"], null, 2) },
    ])

    const filtered = yield* run(
      'const list = await tools.opencode.models({ providerID: "other" }); return list.models.map((model) => model.id)',
    )
    expect(filtered.content).toEqual([{ type: "text", text: JSON.stringify(["beta"], null, 2) }])
  }),
)

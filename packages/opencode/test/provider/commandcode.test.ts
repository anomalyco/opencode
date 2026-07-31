import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Provider } from "@/provider/provider"
import { Env } from "@/env"
import { Plugin } from "@/plugin"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Provider.node, Env.node, Plugin.node])))

describe("commandcode provider", () => {
  it.instance("is seeded in the provider list with the Command Code name", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.use.list()
      const commandcode = providers[ProviderV2.ID.make("commandcode")]
      expect(commandcode).toBeDefined()
      expect(commandcode.name).toBe("Command Code")
      expect(Object.keys(commandcode.models).length).toBeGreaterThan(0)
    }),
  )

  it.instance("applies ZDR headers via the custom loader", () =>
    Effect.gen(function* () {
      const provider = yield* Provider.use.getProvider(ProviderV2.ID.make("commandcode"))
      expect(provider).toBeDefined()
      expect(provider!.options.headers).toMatchObject({ "x-cmd-zdr": "1", "X-Title": "opencode" })
    }),
  )
})

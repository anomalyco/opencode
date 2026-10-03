import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect } from "effect"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Env } from "@/env"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { testEffect } from "../lib/effect"

const providerLayer = () =>
  LayerNode.compile(
    LayerNode.group([
      Provider.node,
      FSUtil.node,
      Env.node,
      Config.node,
      Auth.node,
      Plugin.node,
      ModelsDev.node,
      RuntimeFlags.node,
    ]),
  )

const it = testEffect(providerLayer())

it.instance("picks up externally added auth without dispose", () =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const provider = yield* Provider.Service
    const providerID = ProviderV2.ID.make("anthropic")
    const modelID = ModelV2.ID.make("claude-sonnet-4-6")

    // Start clean so the first load caches state without this provider.
    yield* auth.remove("anthropic").pipe(Effect.ignore)
    // Ensure no env fallback either.
    yield* Env.use.remove("ANTHROPIC_API_KEY").pipe(Effect.ignore)
    const previous = process.env["ANTHROPIC_API_KEY"]
    delete process.env["ANTHROPIC_API_KEY"]
    try {
      const before = yield* provider.getProvider(providerID)
      expect(before).toBeUndefined()

      // Simulate an external auth.json change (another process login/edit).
      // Auth writes the file but Provider state is already cached per directory.
      yield* auth.set("anthropic", { type: "api", key: "sk-test-external" })

      // Without any manual dispose, the cached directory must see the new credentials.
      const after = yield* provider.getProvider(providerID)
      expect(after).toBeDefined()
      expect(after?.source).toBe("api")

      const model = yield* provider.getModel(providerID, modelID)
      expect(String(model.id)).toBe("claude-sonnet-4-6")

      const listed = yield* provider.list()
      expect(listed[providerID]).toBeDefined()

      // Removal must also become visible without manual dispose.
      yield* auth.remove("anthropic")
      const removed = yield* provider.getProvider(providerID)
      expect(removed).toBeUndefined()
    } finally {
      if (previous !== undefined) process.env["ANTHROPIC_API_KEY"] = previous
      else delete process.env["ANTHROPIC_API_KEY"]
      yield* auth.remove("anthropic").pipe(Effect.ignore)
    }
  }),
)

import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { it } from "../lib/effect"

const fromConfig = (input: Record<string, unknown>) =>
  RuntimeFlags.defaultLayer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(input))))

const readFlags = RuntimeFlags.Service.useSync((flags) => flags)

describe("plugin.openai.websocket stable flag", () => {
  it.effect("enables Codex WebSockets by default without channel gating", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({})))

      expect(flags.webSockets).toBe(true)
    }),
  )

  it.effect("disables Codex WebSockets through the stable opt-out", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ OPENCODE_DISABLE_WEBSOCKETS: "true" })))

      expect(flags.webSockets).toBe(false)
    }),
  )
})

import { describe, expect, test } from "bun:test"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { Effect, Schema } from "effect"
import { Config } from "@opencode/core/config"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "../plugin/fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* (entries: Entry[]) {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, "test")
  yield* ConfigProviderPlugin.Plugin.effect(host).pipe(Effect.provide(Config.testLayer(entries)))
})

const decode = Schema.decodeUnknownSync(Info)

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

describe("ConfigProviderPlugin availability overlay", () => {
  it.effect("propagates model availability into Model.Info", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      yield* addPlugin([
        new Document({
          type: "document",
          info: decode({
            providers: {
              deepseek: {
                models: {
                  chat: {
                    availability: {
                      windows: [
                        { days: ["mon", "tue", "wed", "thu", "fri"], start: "01:00", end: "04:00" },
                        { days: ["mon", "tue", "wed", "thu", "fri"], start: "06:00", end: "10:00" },
                      ],
                      fallback: "anthropic/claude-sonnet-4-6",
                    },
                  },
                },
              },
            },
          }),
        }),
      ])
      const info = required(yield* models.get("deepseek" as never, "chat" as never))
      expect(info.availability).toEqual({
        windows: [
          { days: ["mon", "tue", "wed", "thu", "fri"], start: "01:00", end: "04:00" },
          { days: ["mon", "tue", "wed", "thu", "fri"], start: "06:00", end: "10:00" },
        ],
        fallback: "anthropic/claude-sonnet-4-6",
      })
    }),
  )

  it.effect("keeps availability unset for models without config", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      yield* addPlugin([
        new Document({
          type: "document",
          info: decode({
            providers: {
              deepseek: {
                models: {
                  chat: { name: "DeepSeek Chat" },
                },
              },
            },
          }),
        }),
      ])
      const info = required(yield* models.get("deepseek" as never, "chat" as never))
      expect(info.availability).toBeUndefined()
    }),
  )

  test("rejects malformed availability config", () => {
    const cases = [
      { windows: [] }, // empty windows
      { windows: [{ start: "9:00", end: "17:00" }] }, // non-padded hour
      { windows: [{ start: "25:00", end: "26:00" }] }, // out of range
      { windows: [{ start: "09:00", end: "17:00" }], fallback: "no-slash" }, // malformed fallback
    ]
    for (const availability of cases) {
      expect(() =>
        decode({
          providers: { deepseek: { models: { chat: { availability } } } },
        }),
      ).toThrow()
    }
  })
})
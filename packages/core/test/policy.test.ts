import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Location } from "@opencode-ai/core/location"
import { Policy } from "@opencode-ai/core/policy"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(
  Policy.defaultLayer.pipe(
    Layer.provide(
      Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("test") }))),
    ),
  ),
)

describe("Policy", () => {
  it.effect("returns the caller's fallback when no statement matches", () =>
    Effect.gen(function* () {
      const policy = yield* Policy.Service

      expect(yield* policy.evaluate("provider.use", "anthropic", "allow")).toBe("allow")
      expect(yield* policy.evaluate("provider.use", "anthropic", "deny")).toBe("deny")
    }),
  )

  it.effect("evaluates wildcard provider rules in written order", () =>
    Effect.gen(function* () {
      const policy = yield* Policy.Service
      yield* policy.load([
        new Policy.Info({
          effect: "deny",
          action: "provider.*",
          resource: "*",
        }),
        new Policy.Info({
          effect: "allow",
          action: "provider.use",
          resource: "anthropic",
        }),
      ])

      expect(yield* policy.evaluate("provider.use", "anthropic", "allow")).toBe("allow")
      expect(yield* policy.evaluate("provider.use", "openai", "allow")).toBe("deny")
    }),
  )

  it.effect("matches action and resource independently", () =>
    Effect.gen(function* () {
      const policy = yield* Policy.Service
      yield* policy.load([
        new Policy.Info({
          effect: "deny",
          action: "provider.*",
          resource: "company-*",
        }),
      ])

      expect(yield* policy.evaluate("provider.use", "company-stable", "allow")).toBe("deny")
      expect(yield* policy.evaluate("plugin.load", "company-stable", "allow")).toBe("allow")
    }),
  )

  it.effect("uses the last matching loaded statement", () =>
    Effect.gen(function* () {
      const policy = yield* Policy.Service
      yield* policy.load([
        new Policy.Info({
          effect: "allow",
          action: "provider.use",
          resource: "openai",
        }),
        new Policy.Info({
          effect: "deny",
          action: "provider.use",
          resource: "openai",
        }),
      ])

      expect(yield* policy.evaluate("provider.use", "openai", "allow")).toBe("deny")
    }),
  )
})

import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Capability } from "@opencode-ai/core/capability"
import { Effect } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(Capability.node))

describe("Capability", () => {
  it.effect("persists explicit preferences and restores inherited defaults", () =>
    Effect.gen(function* () {
      const capability = yield* Capability.Service
      const ref = Capability.skill("effect")

      expect(yield* capability.resolve(ref)).toBe("enabled")
      yield* capability.set({ ref, state: "disabled" })
      expect(yield* capability.get(ref)).toBe("disabled")
      expect(yield* capability.resolve(ref)).toBe("disabled")

      yield* capability.set({ ref, state: "inherit" })
      expect(yield* capability.get(ref)).toBeUndefined()
      expect(yield* capability.resolve(ref, false)).toBe("disabled")
    }),
  )
})

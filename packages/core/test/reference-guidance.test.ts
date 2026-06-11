import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { Reference } from "@opencode-ai/core/reference"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { SystemContext } from "@opencode-ai/core/system-context/index"
import { it } from "./lib/effect"

describe("ReferenceGuidance", () => {
  it.effect("lists available references in the system context", () =>
    Effect.gen(function* () {
      const guidance = yield* ReferenceGuidance.Service
      const generation = yield* SystemContext.initialize(yield* guidance.load())

      expect(generation.baseline).toContain("<available_references>")
      expect(generation.baseline).toContain("<name>docs</name>")
      expect(generation.baseline).toContain("<path>/docs</path>")
      expect(generation.baseline).toContain("<description>Use for product documentation</description>")
    }).pipe(
      Effect.provide(ReferenceGuidance.layer),
      Effect.provide(
        Layer.mock(Reference.Service, {
          list: () =>
            Effect.succeed([
              new Reference.Info({
                name: "docs",
                path: AbsolutePath.make("/docs"),
                description: "Use for product documentation",
                source: new Reference.LocalSource({
                  type: "local",
                  path: AbsolutePath.make("/docs"),
                  description: "Use for product documentation",
                }),
              }),
            ]),
        }),
      ),
      Effect.provide(Layer.mock(PluginBoot.Service, { wait: () => Effect.void })),
    ),
  )

  it.effect("omits guidance when no references are available", () =>
    Effect.gen(function* () {
      const guidance = yield* ReferenceGuidance.Service
      const generation = yield* SystemContext.initialize(yield* guidance.load())
      expect(generation.baseline).toBe("")
    }).pipe(
      Effect.provide(ReferenceGuidance.layer),
      Effect.provide(Layer.mock(Reference.Service, { list: () => Effect.succeed([]) })),
      Effect.provide(Layer.mock(PluginBoot.Service, { wait: () => Effect.void })),
    ),
  )

  it.effect("omits references without descriptions", () =>
    Effect.gen(function* () {
      const guidance = yield* ReferenceGuidance.Service
      const generation = yield* SystemContext.initialize(yield* guidance.load())
      expect(generation.baseline).toBe("")
    }).pipe(
      Effect.provide(ReferenceGuidance.layer),
      Effect.provide(
        Layer.mock(Reference.Service, {
          list: () =>
            Effect.succeed([
              new Reference.Info({
                name: "docs",
                path: AbsolutePath.make("/docs"),
                source: new Reference.LocalSource({ type: "local", path: AbsolutePath.make("/docs") }),
              }),
            ]),
        }),
      ),
      Effect.provide(Layer.mock(PluginBoot.Service, { wait: () => Effect.void })),
    ),
  )
})

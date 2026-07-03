import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Reference } from "@opencode-ai/core/reference"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { SystemContext } from "@opencode-ai/core/system-context/index"
import { it } from "./lib/effect"

const guidanceLayer = (referenceLayer: Layer.Layer<Reference.Service>) =>
  AppNodeBuilder.build(ReferenceGuidance.node, [[Reference.node, referenceLayer]])

describe("ReferenceGuidance", () => {
  it.effect("lists available references in the system context", () =>
    Effect.gen(function* () {
      const guidance = yield* ReferenceGuidance.Service
      const generation = yield* SystemContext.initialize(yield* guidance.load())

      expect(generation.text).toContain("<available_references>")
      expect(generation.text).toContain("<name>docs</name>")
      expect(generation.text).toContain("<path>/docs</path>")
      expect(generation.text).toContain("<description>Use for product documentation</description>")
    }).pipe(
      Effect.provide(
        guidanceLayer(
          Layer.mock(Reference.Service, {
            list: () =>
              Effect.succeed([
                new Reference.Info({
                  name: "docs",
                  path: AbsolutePath.make("/docs"),
                  description: "Use for product documentation",
                  source: Reference.LocalSource.make({
                    type: "local",
                    path: AbsolutePath.make("/docs"),
                    description: "Use for product documentation",
                  }),
                }),
              ]),
          }),
        ),
      ),
    ),
  )

  it.effect("omits guidance when no references are available", () =>
    Effect.gen(function* () {
      const guidance = yield* ReferenceGuidance.Service
      const generation = yield* SystemContext.initialize(yield* guidance.load())
      expect(generation.text).toBe("")
    }).pipe(Effect.provide(guidanceLayer(Layer.mock(Reference.Service, { list: () => Effect.succeed([]) })))),
  )

  it.effect("omits references without descriptions", () =>
    Effect.gen(function* () {
      const guidance = yield* ReferenceGuidance.Service
      const generation = yield* SystemContext.initialize(yield* guidance.load())
      expect(generation.text).toBe("")
    }).pipe(
      Effect.provide(
        guidanceLayer(
          Layer.mock(Reference.Service, {
            list: () =>
              Effect.succeed([
                new Reference.Info({
                  name: "docs",
                  path: AbsolutePath.make("/docs"),
                  source: Reference.LocalSource.make({ type: "local", path: AbsolutePath.make("/docs") }),
                }),
              ]),
          }),
        ),
      ),
    ),
  )

  it.effect("announces added and removed references as deltas", () => {
    const reference = (name: string, description: string) =>
      new Reference.Info({
        name,
        path: AbsolutePath.make(`/${name}`),
        description,
        source: Reference.LocalSource.make({ type: "local", path: AbsolutePath.make(`/${name}`), description }),
      })
    let references = [reference("docs", "Use for product documentation")]
    return Effect.gen(function* () {
      const guidance = yield* ReferenceGuidance.Service
      const initialized = yield* SystemContext.initialize(yield* guidance.load())

      references = [reference("docs", "Use for product documentation"), reference("examples", "Use for examples")]
      const added = yield* SystemContext.reconcile(yield* guidance.load(), initialized.applied)
      expect(added).toMatchObject({
        _tag: "Updated",
        text: [
          "New project references are available in addition to those previously listed:",
          "  <reference>",
          "    <name>examples</name>",
          "    <path>/examples</path>",
          "    <description>Use for examples</description>",
          "  </reference>",
        ].join("\n"),
      })

      references = [reference("examples", "Use for examples")]
      expect(
        yield* SystemContext.reconcile(yield* guidance.load(), added._tag === "Updated" ? added.applied : {}),
      ).toMatchObject({
        _tag: "Updated",
        text: "The following project references are no longer available and must not be used: docs.",
      })
    }).pipe(Effect.provide(guidanceLayer(Layer.mock(Reference.Service, { list: () => Effect.succeed(references) }))))
  })
})

import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Reference } from "@opencode-ai/core/reference"
import { ReferenceInstructions } from "@opencode-ai/core/reference/instructions"
import { it } from "./lib/effect"
import { readInitial, readUpdate } from "./lib/instructions"

const instructionsLayer = (referenceLayer: Layer.Layer<Reference.Service>) =>
  AppNodeBuilder.build(ReferenceInstructions.node, [[Reference.node, referenceLayer]])

describe("ReferenceInstructions", () => {
  it.effect("lists available references in the instructions", () =>
    Effect.gen(function* () {
      const instructions = yield* ReferenceInstructions.Service
      const generation = yield* readInitial(yield* instructions.load())

      expect(generation.text).toContain("<available_references>")
      expect(generation.text).toContain("<name>docs</name>")
      expect(generation.text).toContain("<path>/docs</path>")
      expect(generation.text).toContain("<description>Use for product documentation</description>")
    }).pipe(
      Effect.provide(
        instructionsLayer(
          Layer.mock(Reference.Service, {
            list: () =>
              Effect.succeed([
                Reference.Info.make({
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

  it.effect("omits instructions when no references are available", () =>
    Effect.gen(function* () {
      const instructions = yield* ReferenceInstructions.Service
      const generation = yield* readInitial(yield* instructions.load())
      expect(generation.text).toBe("")
    }).pipe(Effect.provide(instructionsLayer(Layer.mock(Reference.Service, { list: () => Effect.succeed([]) })))),
  )

  it.effect("omits references without descriptions", () =>
    Effect.gen(function* () {
      const instructions = yield* ReferenceInstructions.Service
      const generation = yield* readInitial(yield* instructions.load())
      expect(generation.text).toBe("")
    }).pipe(
      Effect.provide(
        instructionsLayer(
          Layer.mock(Reference.Service, {
            list: () =>
              Effect.succeed([
                Reference.Info.make({
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
      Reference.Info.make({
        name,
        path: AbsolutePath.make(`/${name}`),
        description,
        source: Reference.LocalSource.make({ type: "local", path: AbsolutePath.make(`/${name}`), description }),
      })
    let references = [reference("docs", "Use for product documentation")]
    return Effect.gen(function* () {
      const instructions = yield* ReferenceInstructions.Service
      const initialized = yield* readInitial(yield* instructions.load())

      references = [reference("docs", "Use for product documentation"), reference("examples", "Use for examples")]
      const added = yield* readUpdate(yield* instructions.load(), initialized)
      expect(added.text).toBe(
        [
          "New project references are available in addition to those previously listed:",
          "  <reference>",
          "    <name>examples</name>",
          "    <path>/examples</path>",
          "    <description>Use for examples</description>",
          "  </reference>",
        ].join("\n"),
      )

      references = [reference("examples", "Use for examples")]
      expect((yield* readUpdate(yield* instructions.load(), added)).text).toBe(
        "The following project references are no longer available and must not be used: docs.",
      )
    }).pipe(
      Effect.provide(instructionsLayer(Layer.mock(Reference.Service, { list: () => Effect.succeed(references) }))),
    )
  })
})

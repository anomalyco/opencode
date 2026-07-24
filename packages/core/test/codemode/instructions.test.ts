import { describe, expect } from "bun:test"
import { CodeMode } from "@opencode-ai/core/codemode"
import { CodeModeInstructions } from "@opencode-ai/core/codemode/instructions"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Tool } from "@opencode-ai/core/tool/tool"
import { Effect, Schema } from "effect"
import { it } from "../lib/effect"
import { readInitial, readUpdate } from "../lib/instructions"

describe("CodeModeInstructions", () => {
  it.effect("treats equivalent registration orders as an instruction no-op", () => {
    const alpha = Tool.make({
      description: "Alpha tool",
      input: Schema.Struct({}),
      output: Schema.String,
      execute: () => Effect.succeed({ output: "alpha" }),
    })
    const zeta = Tool.make({
      description: "Zeta tool",
      input: Schema.Struct({}),
      output: Schema.String,
      execute: () => Effect.succeed({ output: "zeta" }),
    })
    const codeModeLayer = AppNodeBuilder.build(CodeMode.node)

    return Effect.gen(function* () {
      const codeMode = yield* CodeMode.Service
      const initialized = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* codeMode.register(Tool.registrationEntries({ zeta, alpha }, { namespace: "tools" }))
          const materialization = yield* codeMode.materialize()
          return yield* readInitial(CodeModeInstructions.make(materialization.instructions))
        }),
      )
      const reordered = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* codeMode.register(Tool.registrationEntries({ alpha, zeta }, { namespace: "tools" }))
          const materialization = yield* codeMode.materialize()
          return yield* readUpdate(CodeModeInstructions.make(materialization.instructions), initialized)
        }),
      )

      expect(reordered.changed).toBe(false)
      expect(reordered.text).toBe("")
    }).pipe(Effect.provide(codeModeLayer))
  })

  it.effect("renders catalog changes and removal", () => {
    let catalog: string | undefined = "Initial Code Mode catalog"

    return Effect.gen(function* () {
      const initialized = yield* readInitial(CodeModeInstructions.make(catalog))
      expect(initialized.text).toBe("Initial Code Mode catalog")

      catalog = "Updated Code Mode catalog"
      expect(yield* readUpdate(CodeModeInstructions.make(catalog), initialized)).toMatchObject({
        text: "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.\n\nUpdated Code Mode catalog",
      })

      catalog = undefined
      expect(yield* readUpdate(CodeModeInstructions.make(catalog), initialized)).toMatchObject({
        text: "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
      })
    })
  })
})

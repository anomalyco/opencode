import { describe, expect } from "bun:test"
import { AgentV2 } from "@opencode-ai/core/agent"
import { CodeMode } from "@opencode-ai/core/codemode"
import { CodeModeInstructions } from "@opencode-ai/core/codemode/instructions"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Tool } from "@opencode-ai/core/tool/tool"
import { Effect, Layer, Schema } from "effect"
import { it } from "../lib/effect"
import { readInitial, readUpdate } from "../lib/instructions"

const agent = AgentV2.Info.make(AgentV2.Info.empty(AgentV2.ID.make("build")))

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
    const layer = Layer.merge(
      codeModeLayer,
      AppNodeBuilder.build(CodeModeInstructions.node, [[CodeMode.node, codeModeLayer]]),
    )

    return Effect.gen(function* () {
      const codeMode = yield* CodeMode.Service
      const instructions = yield* CodeModeInstructions.Service
      const initialized = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* codeMode.register(Tool.registrationEntries({ zeta, alpha }, { namespace: "tools" }))
          return yield* instructions.load({ id: agent.id, info: agent }).pipe(Effect.flatMap(readInitial))
        }),
      )
      const reordered = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* codeMode.register(Tool.registrationEntries({ alpha, zeta }, { namespace: "tools" }))
          return yield* instructions
            .load({ id: agent.id, info: agent })
            .pipe(Effect.flatMap((context) => readUpdate(context, initialized)))
        }),
      )

      expect(reordered.changed).toBe(false)
      expect(reordered.text).toBe("")
    }).pipe(Effect.provide(layer))
  })

  it.effect("renders catalog changes and removal", () => {
    let catalog: string | undefined = "Initial Code Mode catalog"
    const layer = AppNodeBuilder.build(CodeModeInstructions.node, [
      [
        CodeMode.node,
        Layer.mock(CodeMode.Service, {
          materialize: () => Effect.succeed({ ...(catalog === undefined ? {} : { instructions: catalog }) }),
          register: () => Effect.void,
        }),
      ],
    ])

    return Effect.gen(function* () {
      const instructions = yield* CodeModeInstructions.Service
      const initialized = yield* instructions.load({ id: agent.id, info: agent }).pipe(Effect.flatMap(readInitial))
      expect(initialized.text).toBe("Initial Code Mode catalog")

      catalog = "Updated Code Mode catalog"
      expect(
        yield* instructions
          .load({ id: agent.id, info: agent })
          .pipe(Effect.flatMap((context) => readUpdate(context, initialized))),
      ).toMatchObject({
        text: "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.\n\nUpdated Code Mode catalog",
      })

      catalog = undefined
      expect(
        yield* instructions
          .load({ id: agent.id, info: agent })
          .pipe(Effect.flatMap((context) => readUpdate(context, initialized))),
      ).toMatchObject({
        text: "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
      })
    }).pipe(Effect.provide(layer))
  })
})

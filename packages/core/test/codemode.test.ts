import { describe, expect } from "bun:test"
import { CodeMode } from "@opencode-ai/core/codemode"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Tool } from "@opencode-ai/core/tool/tool"
import { Effect, Schema } from "effect"
import { it } from "./lib/effect"

describe("CodeMode", () => {
  it.effect("owns registrations, execute, and catalog materialization", () =>
    Effect.gen(function* () {
      const codeMode = yield* CodeMode.Service
      yield* codeMode.register(
        Tool.registrationEntries({
          echo: Tool.make({
            description: "Echo text",
            input: Schema.Struct({ text: Schema.String }),
            output: Schema.String,
            execute: ({ text }) => Effect.succeed({ output: text }),
          }),
        }),
      )

      const materialized = yield* codeMode.materialize()
      expect(materialized.tool).toBeDefined()
      expect(materialized.instructions).toContain("Echo text")
      expect(materialized.instructions).toContain("tools.echo(input:")
    }).pipe(Effect.scoped, Effect.provide(AppNodeBuilder.build(CodeMode.node))),
  )
})

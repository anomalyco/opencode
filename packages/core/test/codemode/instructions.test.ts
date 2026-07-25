import { describe, expect } from "bun:test"
import { CodeMode } from "@opencode-ai/core/codemode"
import { CodeModeCatalog } from "@opencode-ai/core/codemode/catalog"
import { CodeModeInstructions } from "@opencode-ai/core/codemode/instructions"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Tool } from "@opencode-ai/core/tool/tool"
import { Effect, Schema } from "effect"
import { it } from "../lib/effect"
import { readInitial, readUpdate } from "../lib/instructions"

const echo: CodeModeCatalog.Entry = {
  path: "notes.echo",
  description: "Echo text",
  signature: "tools.notes.echo(input: {\n  text: string,\n}): Promise<string>",
}

const lookup: CodeModeCatalog.Entry = {
  path: "orders.lookup",
  description: "Look up an order",
  signature: "tools.orders.lookup(input: {\n  id: string,\n}): Promise<unknown>",
}

describe("CodeModeInstructions", () => {
  it.effect("instructs the model not to call execute while the catalog is empty", () =>
    Effect.gen(function* () {
      const initialized = yield* readInitial(CodeModeInstructions.make([]))
      expect(initialized.text).toBe(
        "No Code Mode tools are currently available. Do not call `execute` until a later system update announces available tools.",
      )

      const added = yield* readUpdate(CodeModeInstructions.make([echo]), initialized)
      expect(added.text).toContain("New tools are available in addition to those previously listed:")
      expect(added.text).toContain(echo.signature)

      expect(yield* readUpdate(CodeModeInstructions.make([]), { values: added.values })).toMatchObject({
        text:
          "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.\n\n" +
          "No Code Mode tools are currently available. Do not call `execute` until a later system update announces available tools.",
      })
    }),
  )

  it.effect("renders the initial catalog, semantic deltas, and removal", () =>
    Effect.gen(function* () {
      const initialized = yield* readInitial(CodeModeInstructions.make([echo]))
      expect(initialized.text).toContain("## Available tools")
      expect(initialized.text).not.toContain("## Search")
      expect(initialized.text).toContain(`  - ${echo.signature} // Echo text`)

      const added = yield* readUpdate(CodeModeInstructions.make([echo, lookup]), initialized)
      expect(added.text).toContain("The Code Mode tool catalog has changed.")
      expect(added.text).toContain("New tools are available in addition to those previously listed:")
      expect(added.text).toContain(`  - ${lookup.signature} // Look up an order`)
      expect(added.text).not.toContain("## Available tools")

      const removed = yield* readUpdate(CodeModeInstructions.make([echo]), { values: added.values })
      expect(removed.text).toBe(
        "The Code Mode tool catalog has changed.\n\n" +
          "The following tools are no longer available and must not be called: tools.orders.lookup.",
      )

      expect(yield* readUpdate(CodeModeInstructions.make(), initialized)).toMatchObject({
        text: "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
      })
    }),
  )

  it.effect("stores a canonical sorted snapshot so registration order does not churn history", () => {
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
    const layer = AppNodeBuilder.build(CodeMode.node)

    return Effect.gen(function* () {
      const codeMode = yield* CodeMode.Service
      const initialized = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* codeMode.register(Tool.registrationEntries({ zeta, alpha }, { namespace: "tools" }))
          return yield* readInitial(CodeModeInstructions.make((yield* codeMode.materialize()).catalog))
        }),
      )
      const reordered = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* codeMode.register(Tool.registrationEntries({ alpha, zeta }, { namespace: "tools" }))
          return yield* readUpdate(CodeModeInstructions.make((yield* codeMode.materialize()).catalog), initialized)
        }),
      )

      expect(reordered.changed).toBe(false)
      expect(reordered.text).toBe("")
    }).pipe(Effect.provide(layer))
  })
})

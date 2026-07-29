import { describe, expect } from "bun:test"
import { CodeModeCatalog } from "@opencode-ai/core/codemode/catalog"
import { CodeModeInstructions } from "@opencode-ai/core/codemode/instructions"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Tool } from "@opencode-ai/core/tool"
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
        "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool.",
      )

      const added = yield* readUpdate(CodeModeInstructions.make([echo]), initialized)
      expect(added.text).toContain("New tools are available in addition to those previously listed:")
      expect(added.text).toContain(echo.signature)

      expect(yield* readUpdate(CodeModeInstructions.make([]), { values: added.values })).toMatchObject({
        text:
          "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.\n\n" +
          "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool.",
      })
    }),
  )

  it.effect("renders the initial catalog, semantic deltas, and removal", () =>
    Effect.gen(function* () {
      const initialized = yield* readInitial(CodeModeInstructions.make([echo]))
      expect(initialized.text).toContain(
        "This catalog is the complete set of tools available within Code Mode. Tools presented elsewhere are not available in this runtime.",
      )
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
    const alpha = ({
      name: "alpha",
      description: "Alpha tool",
      input: Schema.Struct({}),
      output: Schema.String,
      execute: () => Effect.succeed({ output: "alpha" }),
    })
    const zeta = ({
      name: "zeta",
      description: "Zeta tool",
      input: Schema.Struct({}),
      output: Schema.String,
      execute: () => Effect.succeed({ output: "zeta" }),
    })
    const layer = AppNodeBuilder.build(Tool.node, [
      [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
    ])

    return Effect.gen(function* () {
      const tools = yield* Tool.Service
      const initialized = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* tools.transform((draft) => {
            draft.add({ ...zeta, options: { namespace: "tools" } })
            draft.add({ ...alpha, options: { namespace: "tools" } })
          })
          return yield* readInitial(
            CodeModeInstructions.make((yield* tools.snapshot()).codeModeCatalog),
          )
        }),
      )
      const reordered = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* tools.transform((draft) => {
            draft.add({ ...alpha, options: { namespace: "tools" } })
            draft.add({ ...zeta, options: { namespace: "tools" } })
          })
          return yield* readUpdate(
            CodeModeInstructions.make((yield* tools.snapshot()).codeModeCatalog),
            initialized,
          )
        }),
      )

      expect(reordered.changed).toBe(false)
      expect(reordered.text).toBe("")
    }).pipe(Effect.provide(layer))
  })
})

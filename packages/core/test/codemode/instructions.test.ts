import { describe, expect } from "bun:test"
import { AgentV2 } from "@opencode-ai/core/agent"
import { CodeMode } from "@opencode-ai/core/codemode"
import { CodeModeCatalog } from "@opencode-ai/core/codemode/catalog"
import { CodeModeInstructions } from "@opencode-ai/core/codemode/instructions"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Effect, Layer } from "effect"
import { it } from "../lib/effect"
import { readInitial, readUpdate } from "../lib/instructions"

const agent = AgentV2.Info.make(AgentV2.Info.empty(AgentV2.ID.make("build")))

const echo = {
  path: "notes.echo",
  description: "Echo text",
  signature: "tools.notes.echo(input: {\n  text: string,\n}): Promise<string>",
}

const lookup = {
  path: "orders.lookup",
  description: "Look up an order",
  signature: "tools.orders.lookup(input: {\n  id: string,\n}): Promise<unknown>",
}

describe("CodeModeInstructions", () => {
  it.effect("renders the initial catalog, semantic deltas, and removal", () => {
    let catalog: ReadonlyArray<CodeModeCatalog.Entry> | undefined = [echo]
    const layer = AppNodeBuilder.build(CodeModeInstructions.node, [
      [
        CodeMode.node,
        Layer.mock(CodeMode.Service, {
          materialize: () => Effect.succeed({ ...(catalog === undefined ? {} : { catalog }) }),
          register: () => Effect.void,
        }),
      ],
    ])

    return Effect.gen(function* () {
      const instructions = yield* CodeModeInstructions.Service
      const initialized = yield* instructions.load({ id: agent.id, info: agent }).pipe(Effect.flatMap(readInitial))
      expect(initialized.text).toContain("## Available tools (COMPLETE list")
      expect(initialized.text).toContain(`  - ${echo.signature} // Echo text`)

      catalog = [echo, lookup]
      const added = yield* instructions
        .load({ id: agent.id, info: agent })
        .pipe(Effect.flatMap((context) => readUpdate(context, initialized)))
      expect(added.text).toContain("The Code Mode tool catalog has changed.")
      expect(added.text).toContain("New tools are available in addition to those previously listed:")
      expect(added.text).toContain(`  - ${lookup.signature} // Look up an order`)
      expect(added.text).not.toContain("## Available tools")

      catalog = [echo]
      const removed = yield* instructions
        .load({ id: agent.id, info: agent })
        .pipe(Effect.flatMap((context) => readUpdate(context, { values: added.values })))
      expect(removed.text).toBe(
        "The Code Mode tool catalog has changed.\n\n" +
          "The following tools are no longer available and must not be called: tools.orders.lookup.",
      )

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

  it.effect("stores a canonical sorted snapshot so registration order does not churn history", () => {
    let catalog: ReadonlyArray<CodeModeCatalog.Entry> = [lookup, echo]
    const layer = AppNodeBuilder.build(CodeModeInstructions.node, [
      [
        CodeMode.node,
        Layer.mock(CodeMode.Service, {
          materialize: () => Effect.succeed({ catalog }),
          register: () => Effect.void,
        }),
      ],
    ])

    return Effect.gen(function* () {
      const instructions = yield* CodeModeInstructions.Service
      const initialized = yield* instructions.load({ id: agent.id, info: agent }).pipe(Effect.flatMap(readInitial))

      catalog = [echo, lookup]
      const update = yield* instructions
        .load({ id: agent.id, info: agent })
        .pipe(Effect.flatMap((context) => readUpdate(context, initialized)))
      expect(update.changed).toBe(false)
    }).pipe(Effect.provide(layer))
  })
})

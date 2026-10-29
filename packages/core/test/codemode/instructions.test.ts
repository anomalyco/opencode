import { describe, expect } from "bun:test"
import { CodeModeCatalog } from "@opencode/core/codemode/catalog"
import { CodeModeInstructions } from "@opencode/core/codemode/instructions"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Tool } from "@opencode/core/tool"
import { Effect, Schema } from "effect"
import { it } from "../lib/effect"
import { readInitial, readUpdate } from "../lib/instructions"

const echo: CodeModeCatalog.Tool = {
  type: "tool",
  name: "notes.echo",
  description: "Echo text",
  signature: "tools.notes.echo({\n  text: string,\n}): Promise<string>",
}

const lookup: CodeModeCatalog.Tool = {
  type: "tool",
  name: "orders.lookup",
  description: "Look up an order",
  signature: "tools.orders.lookup({\n  id: string,\n}): Promise<unknown>",
}

/** Signatures long enough that only part of the inventory fits the inline budget. */
const bulky = (count: number): Array<CodeModeCatalog.Tool> =>
  Array.from({ length: count }, (_, index) => ({
    type: "tool",
    name: `blender.tool${index}`,
    description: `Tool ${index}`,
    signature: `tools.blender.tool${index}({\n  ${"a".repeat(160)}: string,\n}): Promise<string>`,
  }))

describe("CodeModeInstructions", () => {
  it.effect("instructs the model not to call execute while the catalog is empty", () =>
    Effect.gen(function* () {
      const initialized = yield* readInitial(CodeModeInstructions.make({ tools: [] }))
      expect(initialized.text).toBe(
        "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool.",
      )

      const added = yield* readUpdate(CodeModeInstructions.make({ tools: [echo] }), initialized)
      expect(added.text).toContain("New tools are available in addition to those previously listed:")
      expect(added.text).toContain(echo.signature)

      expect(yield* readUpdate(CodeModeInstructions.make({ tools: [] }), { values: added.values })).toMatchObject({
        text:
          "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.\n\n" +
          "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool.",
      })
    }),
  )

  it.effect("renders the initial catalog, semantic deltas, and removal", () =>
    Effect.gen(function* () {
      const initialized = yield* readInitial(CodeModeInstructions.make({ tools: [echo] }))
      expect(initialized.text).toContain(
        "The tools listed below cannot be called directly: they only work as JavaScript inside the `execute` tool.",
      )
      expect(initialized.text).toContain("The catalog is complete.")
      expect(initialized.text).toContain("## Code Mode tools (call only inside `execute`)")
      expect(initialized.text).toContain(`  - ${echo.signature} // Echo text`)

      const added = yield* readUpdate(CodeModeInstructions.make({ tools: [echo, lookup] }), initialized)
      expect(added.text).toContain("The Code Mode tool catalog has changed.")
      expect(added.text).toContain("New tools are available in addition to those previously listed:")
      expect(added.text).toContain(`  - ${lookup.signature} // Look up an order`)
      expect(added.text).not.toContain("## Code Mode tools (call only inside `execute`)")

      const removed = yield* readUpdate(CodeModeInstructions.make({ tools: [echo] }), { values: added.values })
      expect(removed.text).toBe(
        "The Code Mode tool catalog has changed.\n\n" +
          "The following tools are no longer available and must not be called: tools.orders.lookup.",
      )

      expect(yield* readUpdate(CodeModeInstructions.make(), initialized)).toMatchObject({
        text: "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
      })
    }),
  )

  it.effect("sends an incremental delta when a partial catalog changes", () =>
    Effect.gen(function* () {
      const stable = bulky(40)
      const volatileTool: CodeModeCatalog.Tool = {
        type: "tool",
        name: "session.session_task_add",
        description: "Add a task to the session",
        signature: "tools.session.session_task_add({\n  title: string,\n}): Promise<void>",
      }
      const initialized = yield* readInitial(CodeModeInstructions.make({ tools: stable }))
      expect(initialized.text).toContain("The catalog is partial.")

      const added = yield* readUpdate(CodeModeInstructions.make({ tools: [...stable, volatileTool] }), initialized)
      expect(added.changed).toBe(true)
      expect(added.text).toBe(
        "The Code Mode tool catalog has changed.\n\n" + "New tool namespaces are available: `session` (1 tools).",
      )

      const removed = yield* readUpdate(CodeModeInstructions.make({ tools: stable }), added)
      expect(removed.text).toBe(
        "The Code Mode tool catalog has changed.\n\n" +
          "The following tools are no longer available and must not be called: tools.session.session_task_add.",
      )
    }),
  )

  it.effect("injects nothing when only the inline sample rotates", () =>
    Effect.gen(function* () {
      const inventory = { tools: bulky(40) }
      // Different inline samples of one unchanged inventory: the first inlines what fits
      // the budget, the second inlines nothing at all.
      const sampled = yield* readInitial(CodeModeInstructions.make(inventory))
      const bare = yield* readInitial(CodeModeInstructions.make(inventory, { budget: 0 }))
      expect(sampled.text).not.toBe(bare.text)
      expect(bare.text).toContain("The catalog is partial.")
      // The persisted identity ignores the sample, so rotation cannot admit an update.
      expect(bare.values).toEqual(sampled.values)
      const rotated = yield* readUpdate(CodeModeInstructions.make(inventory, { budget: 0 }), sampled)
      expect(rotated.changed).toBe(false)
      expect(rotated.text).toBe("")
    }),
  )

  it.effect("stores a canonical sorted snapshot so registration order does not churn history", () => {
    const alpha = {
      name: "alpha",
      description: "Alpha tool",
      input: Schema.Struct({}),
      output: Schema.String,
      execute: () => Effect.succeed({ output: "alpha" }),
    }
    const zeta = {
      name: "zeta",
      description: "Zeta tool",
      input: Schema.Struct({}),
      output: Schema.String,
      execute: () => Effect.succeed({ output: "zeta" }),
    }
    const layer = AppNodeBuilder.build(Tool.node, [
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
    ])

    return Effect.gen(function* () {
      const tools = yield* Tool.Service
      const initialized = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* tools.transform((editor) => {
            editor.namespace({ name: "tools", description: "Project utilities" })
            editor.add({ ...zeta, options: { namespace: "tools" } })
            editor.add({ ...alpha, options: { namespace: "tools" } })
          })
          const snapshot = yield* tools.snapshot()
          return yield* readInitial(CodeModeInstructions.make(snapshot.codeModeCatalog))
        }),
      )
      const reordered = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* tools.transform((editor) => {
            editor.namespace({ name: "tools", description: "Project utilities" })
            editor.add({ ...alpha, options: { namespace: "tools" } })
            editor.add({ ...zeta, options: { namespace: "tools" } })
          })
          const snapshot = yield* tools.snapshot()
          return yield* readUpdate(CodeModeInstructions.make(snapshot.codeModeCatalog), initialized)
        }),
      )

      expect(initialized.text).toContain("- tools (2 tools) // Project utilities")
      expect(reordered.changed).toBe(false)
      expect(reordered.text).toBe("")
    }).pipe(Effect.provide(layer))
  })

  it.effect("announces a new namespace with its tool count instead of its listings", () =>
    Effect.gen(function* () {
      const orders = {
        type: "namespace",
        name: "orders",
        description: "Order tooling",
        tools: [lookup],
      } as const
      const initialized = yield* readInitial(CodeModeInstructions.make({ tools: [echo] }))
      const added = yield* readUpdate(CodeModeInstructions.make({ tools: [echo, orders] }), initialized)
      expect(added.text).toContain("New tool namespaces are available: `orders` (1 tools).")    }),
  )

  it.effect("reports a changed namespace inventory and the tools that arrived with it", () =>
    Effect.gen(function* () {
      const more: CodeModeCatalog.Tool = {
        type: "tool",
        name: "history",
        description: "Recent orders",
        signature: "tools.orders.history({\n  limit: number,\n}): Promise<unknown>",
      }
      const before = yield* readInitial(
        CodeModeInstructions.make({
          tools: [{ type: "namespace", name: "orders", description: "Order tooling", tools: [lookup] }],
        }),
      )
      const after = yield* readUpdate(
        CodeModeInstructions.make({
          tools: [{ type: "namespace", name: "orders", description: "Order tooling", tools: [lookup, more] }],
        }),
        before,
      )
      expect(after.text).toContain(
        "The following namespace inventories changed; search them again before relying on previous results: `orders` now has 2 tools.",
      )
      expect(after.text).toContain(`  - ${more.signature} // Recent orders`)
    }),
  )

  it.effect("restates a namespace line when only its description changes", () =>
    Effect.gen(function* () {
      const before = yield* readInitial(
        CodeModeInstructions.make({
          tools: [{ type: "namespace", name: "orders", description: "Order tooling", tools: [lookup] }],
        }),
      )
      const after = yield* readUpdate(
        CodeModeInstructions.make({
          tools: [{ type: "namespace", name: "orders", description: "Order lookups and history", tools: [lookup] }],
        }),
        before,
      )
      expect(after.text).toBe(
        "The Code Mode tool catalog has changed.\n\n" +
          "The following namespace summaries supersede the previously listed ones:\n" +
          "- orders (1 tool) // Order lookups and history",
      )
    }),
  )

  it.effect("supersedes a changed listing without declaring the tool gone", () =>
    Effect.gen(function* () {
      const before = yield* readInitial(CodeModeInstructions.make({ tools: [lookup] }))
      const reworked: CodeModeCatalog.Tool = {
        ...lookup,
        description: "Look up an order by id",
        signature: "tools.orders.lookup({\n  id: string,\n  expand?: boolean,\n}): Promise<unknown>",
      }
      const after = yield* readUpdate(CodeModeInstructions.make({ tools: [reworked] }), before)
      expect(after.text).toBe(
        "The Code Mode tool catalog has changed.\n\n" +
          "Changed tool listings supersede the previously listed ones:\n" +
          `  - ${reworked.signature} // Look up an order by id`,
      )
    }),
  )

  it.effect("never sends more than the catalog it replaced", () =>
    Effect.gen(function* () {
      const before = yield* readInitial(CodeModeInstructions.make({ tools: [echo] }))
      const after = yield* readUpdate(CodeModeInstructions.make({ tools: [echo, ...bulky(40)] }), before)
      const whole = yield* readInitial(CodeModeInstructions.make({ tools: [echo, ...bulky(40)] }))
      expect(after.text.length).toBeLessThan(whole.text.length)
      expect(after.text).toBe("The Code Mode tool catalog has changed.\n\nNew tool namespaces are available: `blender` (40 tools).")
    }),
  )

  it.effect("describes one change identically whatever the inline sample shows", () =>
    Effect.gen(function* () {
      const inventory = { tools: bulky(12) }
      const grown = { tools: bulky(13) }
      const before = yield* readInitial(CodeModeInstructions.make(inventory))
      const sampled = yield* readUpdate(CodeModeInstructions.make(grown), before)
      const bare = yield* readUpdate(CodeModeInstructions.make(grown, { budget: 0 }), before)
      expect(sampled.text).toBe(bare.text)
      expect(sampled.text).toContain("New tools are available in addition to those previously listed:")
      expect(sampled.text).toContain("  - tools.blender.tool12(")
    }),
  )
})

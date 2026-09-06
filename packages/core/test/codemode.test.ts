import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Tool } from "@opencode-ai/core/tool"
import { Effect, Schema } from "effect"
import { it } from "./lib/effect"

describe("CodeMode", () => {
  it.effect("owns registrations, execute, and catalog materialization", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      yield* tools.transform((editor) => {
        editor.namespace({ name: "empty", description: "No tools registered yet" })
        editor.add({
          name: "echo",
          description: "Echo text",
          input: Schema.Struct({ text: Schema.String }),
          output: Schema.String,
          options: { pinned: true },
          execute: ({ text }) => Effect.succeed({ output: text }),
        })
      })

      const snapshot = yield* tools.snapshot()
      expect(snapshot.definitions.some((tool) => tool.name === "execute")).toBe(true)
      expect(snapshot.codeModeCatalog).toStrictEqual({
        tools: [
          {
            type: "tool",
            name: "echo",
            description: "Echo text",
            signature: "tools.echo(input: {\n  text: string,\n}): Promise<string>",
            pinned: true,
          },
          {
            type: "namespace",
            name: "empty",
            description: "No tools registered yet",
            tools: [],
          },
        ],
      })
    }).pipe(
      Effect.scoped,
      Effect.provide(
        AppNodeBuilder.build(Tool.node, [
          Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
        ]),
      ),
    ),
  )
})

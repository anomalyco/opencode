import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Tool } from "@opencode-ai/core/tool"
import { Agent } from "@opencode-ai/core/agent"
import { Session } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
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
        editor.add({
          name: "script",
          description: "Run script text",
          input: Schema.Struct({ source: Schema.String }),
          output: Schema.String,
          freeform: { input: "source" },
          execute: ({ source }) => Effect.succeed({ output: source }),
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
          {
            type: "tool",
            name: "script",
            description: "Run script text",
            signature: "tools.script(input: string): Promise<string>",
            pinned: false,
          },
        ],
      })
      const result = yield* snapshot.execute({
        sessionID: Session.ID.make("ses_codemode_freeform"),
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.make("msg_codemode_freeform"),
        call: {
          type: "tool-call",
          id: "call-codemode-freeform",
          name: "execute",
          input: { code: 'return await tools.script("hello")' },
        },
      })
      expect(result.output).toMatchObject({ output: "hello" })
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

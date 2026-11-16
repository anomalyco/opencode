import { describe, expect } from "bun:test"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Config } from "@opencode/core/config"
import { Flag } from "@opencode/core/flag"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { Tool } from "@opencode/core/tool"
import { Agent } from "@opencode/core/agent"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Deferred, Effect, Fiber, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { Document } from "@opencode/schema/config"
import type { Info } from "@opencode/schema/tool"
import { testEffect } from "./lib/effect"

const flags = Flag.testLayer([document(false)], { app: { channel: "latest" }, overrides: "" })
const toolNode = AppNodeBuilder.build(Tool.node, [
  Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
  Flag.node.replace(flags),
])
const it = testEffect(Layer.mergeAll(toolNode, flags))

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
            signature: "tools.echo({\n  text: string,\n}): Promise<string>",
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
    }),
  )

  it.effect("never hands a stop to a nested call, so its error cannot replace the execute call's result", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      yield* tools.transform((editor) => {
        editor.add({
          name: "stoppable",
          description: "Stops on cancel",
          input: Schema.Struct({}),
          output: Schema.String,
          execute: (_input, context) =>
            context.cancel
              ? context.cancel.pipe(Effect.andThen(Effect.fail(new Tool.Error({ message: "nested stopped" }))))
              : Effect.succeed({ output: "ran" }),
        })
      })
      const snapshot = yield* tools.snapshot()
      const result = yield* snapshot.execute({
        sessionID: Session.ID.make("ses_codemode_cancel"),
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.create(),
        call: {
          type: "tool-call",
          id: "call-execute",
          name: "execute",
          input: { code: "return await tools.stoppable({})" },
        },
        // Already stopped: the execute call itself does not wait for it.
        cancel: Effect.void,
      })
      expect(JSON.stringify(result.content)).toContain("ran")
      expect(JSON.stringify(result.content)).not.toContain("nested stopped")
    }),
  )

  it.effect("renders Effect numbers in built-in tool signatures as number", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      const ref = Schema.String.annotate({ identifier: "Ref", description: "Element ref" })
      const sentinel = Schema.Literals(["NaN", "Infinity", "-Infinity"])
      const Measure = {
        name: "measure",
        description: "Measure",
        input: Schema.Struct({ ref, amount: Schema.Number, sentinel }),
        output: Schema.Struct({ exit: Schema.optionalKey(Schema.Number), sentinel }),
        execute: () => Effect.succeed({ output: { exit: 0, sentinel: "NaN" as const } }),
      } satisfies Info<any, any>
      yield* tools.transform((editor) => {
        editor.add(Measure)
        editor.add({ ...Measure, name: "direct", options: { codemode: false } })
      })

      const snapshot = yield* tools.snapshot()
      expect(snapshot.codeModeCatalog?.tools).toEqual([
        {
          type: "tool",
          name: "measure",
          description: "Measure",
          signature: [
            "tools.measure({",
            "  /** Element ref */",
            "  ref: string,",
            "  amount: number,",
            '  sentinel: "NaN" | "Infinity" | "-Infinity",',
            "}): Promise<{",
            "  exit?: number,",
            '  sentinel: "NaN" | "Infinity" | "-Infinity",',
            "}>",
          ].join("\n"),
          pinned: false,
        },
      ])
      // Provider definitions keep Effect's plain JSON Schema encoding.
      const direct = JSON.stringify(snapshot.definitions.find((tool) => tool.name === "direct"))
      expect(direct).toContain('{"anyOf":[{"type":"number"},{"type":"string","enum":["Infinity","-Infinity","NaN"]}]}')
      expect(direct).not.toContain("$ref")
    }),
  )

  it.effect("hides per-call timeout guidance and rejects options while disabled", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      const inputs: unknown[] = []
      yield* tools.transform((editor) => {
        editor.add({
          name: "echo",
          description: "Echo text",
          input: Schema.Struct({ text: Schema.String }),
          output: Schema.String,
          execute: (input) =>
            Effect.sync(() => {
              inputs.push(input)
              return { output: input.text }
            }),
        })
      })

      const snapshot = yield* tools.snapshot()
      expect(snapshot.definitions.find((tool) => tool.name === "execute")?.description).not.toContain("timeoutMs")
      const result = yield* run(snapshot, 'return await tools.echo({ text: "first" }, { timeoutMs: 100 })')
      expect(result.metadata).toEqual({ toolCalls: [], error: true })
      expect(JSON.stringify(result.content)).toContain("expects at most one input object")
      expect(inputs).toEqual([])
    }),
  )

  it.effect("keeps successful sibling output when an opted-in tool call times out", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      const config = yield* Config.Test
      yield* config.setEntries([document(true)])
      const started = yield* Deferred.make<void>()
      const inputs: unknown[] = []
      yield* tools.transform((editor) => {
        editor.add({
          name: "echo",
          description: "Echo text",
          input: Schema.Struct({ text: Schema.String }),
          output: Schema.String,
          execute: (input) =>
            Effect.sync(() => {
              inputs.push(input)
              return { output: input.text }
            }),
        })
        editor.add({
          name: "wait",
          description: "Never returns",
          input: Schema.Struct({ text: Schema.String }),
          output: Schema.String,
          execute: (input) =>
            Effect.sync(() => inputs.push(input)).pipe(
              Effect.andThen(Deferred.succeed(started, undefined)),
              Effect.andThen(Effect.never),
            ),
        })
      })

      const snapshot = yield* tools.snapshot()
      expect(snapshot.definitions.find((tool) => tool.name === "execute")?.description).toContain(
        "tools.example(input, { timeoutMs: 120000 })",
      )
      const fiber = yield* run(
        snapshot,
        `const inputs = [{ text: "first" }, { text: "second" }, { text: "waiting" }]
         const settled = await Promise.allSettled([
           tools.echo(inputs[0], { timeoutMs: 100 }),
           tools.echo(inputs[1], { timeoutMs: 100 }),
           tools.wait(inputs[2], { timeoutMs: 100 }),
         ])
         return { settled, inputs }`,
      ).pipe(Effect.forkChild({ startImmediately: true }))
      yield* Deferred.await(started)
      yield* Effect.yieldNow
      yield* TestClock.adjust("100 millis")
      const result = yield* Fiber.join(fiber)
      expect(result.metadata).toEqual({
        toolCalls: [
          { tool: "echo", status: "completed", input: { text: "first" } },
          { tool: "echo", status: "completed", input: { text: "second" } },
          { tool: "wait", status: "error", input: { text: "waiting" } },
        ],
      })
      expect(JSON.parse(result.content.find((part) => part.type === "text")?.text ?? "null")).toEqual({
        settled: [
          { status: "fulfilled", value: "first" },
          { status: "fulfilled", value: "second" },
          { status: "rejected", reason: { name: "Error", message: "Tool 'wait' timed out after 100ms." } },
        ],
        inputs: [{ text: "first" }, { text: "second" }, { text: "waiting" }],
      })
      expect(inputs).toEqual([{ text: "first" }, { text: "second" }, { text: "waiting" }])
    }),
  )

  it.effect("keeps an omitted per-call timeout pending until its tool is released", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      const config = yield* Config.Test
      yield* config.setEntries([document(true)])
      const started = yield* Deferred.make<void>()
      const released = yield* Deferred.make<void>()
      yield* tools.transform((editor) => {
        editor.add({
          name: "wait",
          description: "Wait for release",
          input: Schema.Struct({}),
          output: Schema.String,
          execute: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(released)),
              Effect.as({ output: "released" }),
            ),
        })
      })

      const fiber = yield* run(yield* tools.snapshot(), "return await tools.wait({})").pipe(
        Effect.forkChild({ startImmediately: true }),
      )
      yield* Deferred.await(started)
      yield* Effect.yieldNow
      yield* TestClock.adjust("10 minutes")
      expect(fiber.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(released, undefined)
      const result = yield* Fiber.join(fiber)
      expect(result.content).toEqual([{ type: "text", text: "released" }])
      expect(result.metadata).toEqual({ toolCalls: [{ tool: "wait", status: "completed" }] })
    }),
  )

  it.effect("refreshes cached Code Mode definitions and runtimes when the timeout flag changes", () =>
    Effect.gen(function* () {
      const tools = yield* Tool.Service
      const config = yield* Config.Test
      yield* tools.transform((editor) => {
        editor.add({
          name: "echo",
          description: "Echo text",
          input: Schema.Struct({ text: Schema.String }),
          output: Schema.String,
          execute: (input) => Effect.succeed({ output: input.text }),
        })
      })

      const disabled = yield* tools.snapshot()
      const cached = yield* tools.snapshot()
      expect(cached.definitions.at(-1)).toBe(disabled.definitions.at(-1))
      expect(cached.codeModeCatalog).toBe(disabled.codeModeCatalog)
      yield* config.setEntries([document(true)])
      const enabled = yield* tools.snapshot()
      expect(enabled.definitions.at(-1)?.description).toContain("tools.example(input, { timeoutMs: 120000 })")
      expect(enabled.definitions.at(-1)).not.toBe(disabled.definitions.at(-1))
      expect(enabled.codeModeCatalog).not.toBe(disabled.codeModeCatalog)
      expect(enabled.codeModeCatalog).toEqual(disabled.codeModeCatalog)
      expect((yield* run(enabled, 'return await tools.echo({ text: "enabled" }, { timeoutMs: 100 })')).content).toEqual(
        [{ type: "text", text: "enabled" }],
      )

      // A snapshot keeps the capability it advertised even after the config changes.
      expect(
        (yield* run(disabled, 'return await tools.echo({ text: "old" }, { timeoutMs: 100 })')).metadata?.error,
      ).toBe(true)
      yield* config.setEntries([document(false)])
      const refreshed = yield* tools.snapshot()
      expect(refreshed.definitions.at(-1)?.description).not.toContain("timeoutMs")
      expect(
        (yield* run(refreshed, 'return await tools.echo({ text: "disabled" }, { timeoutMs: 100 })')).metadata?.error,
      ).toBe(true)
    }),
  )
})

function document(enabled: boolean) {
  return Schema.decodeUnknownSync(Document)({
    type: "document",
    info: { experimental: { codemode_tool_timeouts: enabled } },
  })
}

function run(snapshot: Tool.Snapshot, code: string) {
  return snapshot.execute({
    sessionID: Session.ID.make("ses_codemode_timeout"),
    agent: Agent.ID.make("build"),
    messageID: SessionMessage.ID.create(),
    call: { type: "tool-call", id: "call-execute", name: "execute", input: { code } },
  })
}

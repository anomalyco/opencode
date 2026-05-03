import { describe, test, expect } from "bun:test"
import { Effect, Layer, ManagedRuntime, Schema } from "effect"
import { Agent } from "../../src/agent/agent"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"

const runtime = ManagedRuntime.make(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))

const params = Schema.Struct({ input: Schema.String })

function makeTool(id: string, executeFn?: () => void) {
  return {
    description: "test tool",
    parameters: params,
    execute() {
      executeFn?.()
      return Effect.succeed({ title: "test", output: "ok", metadata: {} })
    },
  }
}

describe("Tool.define", () => {
  test("object-defined tool does not mutate the original init object", async () => {
    const original = makeTool("test")
    const originalExecute = original.execute

    const info = await runtime.runPromise(Tool.define("test-tool", Effect.succeed(original)))

    await Effect.runPromise(info.init())
    await Effect.runPromise(info.init())
    await Effect.runPromise(info.init())

    expect(original.execute).toBe(originalExecute)
  })

  test("effect-defined tool returns fresh objects and is unaffected", async () => {
    const info = await runtime.runPromise(
      Tool.define(
        "test-fn-tool",
        Effect.succeed(() => Effect.succeed(makeTool("test"))),
      ),
    )

    const first = await Effect.runPromise(info.init())
    const second = await Effect.runPromise(info.init())

    expect(first).not.toBe(second)
  })

  test("object-defined tool returns distinct objects per init() call", async () => {
    const info = await runtime.runPromise(Tool.define("test-copy", Effect.succeed(makeTool("test"))))

    const first = await Effect.runPromise(info.init())
    const second = await Effect.runPromise(info.init())

    expect(first).not.toBe(second)
  })

  test("execute receives decoded parameters", async () => {
    const parameters = Schema.Struct({
      count: Schema.NumberFromString.pipe(Schema.optional, Schema.withDecodingDefaultType(Effect.succeed(5))),
    })
    const calls: Array<Schema.Schema.Type<typeof parameters>> = []
    const info = await runtime.runPromise(
      Tool.define(
        "test-decoded",
        Effect.succeed({
          description: "test tool",
          parameters,
          execute(args: Schema.Schema.Type<typeof parameters>) {
            calls.push(args)
            return Effect.succeed({ title: "test", output: "ok", metadata: { truncated: false } })
          },
        }),
      ),
    )
    const ctx: Tool.Context = {
      sessionID: SessionID.descending(),
      messageID: MessageID.ascending(),
      agent: "build",
      abort: new AbortController().signal,
      messages: [],
      metadata() {
        return Effect.void
      },
      ask() {
        return Effect.void
      },
    }
    const tool = await Effect.runPromise(info.init())
    const execute = tool.execute as unknown as (args: unknown, ctx: Tool.Context) => ReturnType<typeof tool.execute>

    await Effect.runPromise(execute({}, ctx))
    await Effect.runPromise(execute({ count: "7" }, ctx))

    expect(calls).toEqual([{ count: 5 }, { count: 7 }])
  })
})

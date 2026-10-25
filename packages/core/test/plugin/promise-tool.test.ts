import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Tool } from "@opencode/core/tool"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Cause, Deferred, Effect, Exit, Fiber, Option } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.live("Promise tool executors receive interruption through their AbortSignal", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const tools = yield* Tool.Service
    const started = yield* Deferred.make<AbortSignal>()
    yield* PluginPromise.fromPromise({
      id: "cancel-tool",
      async setup(context) {
        await context.tool.transform((editor) =>
          editor.add({
            name: "wait",
            description: "Wait until cancelled",
            input: { type: "object", properties: {}, additionalProperties: false },
            options: { codemode: false },
            execute: (_input, context) =>
              new Promise<never>((_resolve, reject) => {
                context.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })
                Effect.runSync(Deferred.succeed(started, context.signal))
              }),
          }),
        )
      },
    }).effect(yield* PluginHost.make(plugins))

    const snapshot = yield* tools.snapshot()
    const fiber = yield* snapshot
      .execute({
        sessionID: Session.ID.make("ses_promise_tool_cancel"),
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.make("msg_promise_tool_cancel"),
        call: { type: "tool-call", id: "call_promise_tool_cancel", name: "wait", input: {} },
      })
      .pipe(Effect.forkScoped)
    const signal = yield* Deferred.await(started)
    expect(signal.aborted).toBe(false)
    yield* Fiber.interrupt(fiber)
    const exit = yield* Fiber.await(fiber)
    expect(signal.aborted).toBe(true)
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
  }),
)

const execute = (snapshot: Tool.Snapshot, name: string) =>
  snapshot
    .execute({
      sessionID: Session.ID.make("ses_promise_tool_error"),
      agent: Agent.ID.make("build"),
      messageID: SessionMessage.ID.make("msg_promise_tool_error"),
      call: { type: "tool-call", id: `call_${name}`, name, input: {} },
    })
    .pipe(Effect.exit)

it.live("Promise tool throws become tool failures", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const tools = yield* Tool.Service
    yield* PluginPromise.fromPromise({
      id: "throwing-tools",
      async setup(context) {
        await context.tool.transform((editor) => {
          editor.add({
            name: "plain",
            description: "Throw an Error",
            input: { type: "object", properties: {}, additionalProperties: false },
            options: { codemode: false },
            execute: async () => {
              throw new Error("plain failure")
            },
          })
          editor.add({
            name: "typed",
            description: "Throw a Tool.Error",
            input: { type: "object", properties: {}, additionalProperties: false },
            options: { codemode: false },
            execute: async () => {
              throw new Tool.Error({ message: "typed failure", metadata: { code: 7 } })
            },
          })
        })
      },
    }).effect(yield* PluginHost.make(plugins))

    const snapshot = yield* tools.snapshot()
    const plain = yield* execute(snapshot, "plain")
    const typed = yield* execute(snapshot, "typed")
    expect(Option.getOrUndefined(Exit.findErrorOption(plain))).toMatchObject({ message: "plain failure" })
    expect(Option.getOrUndefined(Exit.findErrorOption(typed))).toMatchObject({
      message: "typed failure",
      metadata: { code: 7 },
    })
  }),
)

it.live("Promise tools that rethrow a decline attach it to the tool failure", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const tools = yield* Tool.Service
    const declined = new Permission.DeclinedError()
    yield* tools.transform((editor) =>
      editor.add({
        name: "guarded",
        description: "Decline every call",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { codemode: false },
        execute: () => Effect.die(declined),
      }),
    )
    yield* PluginPromise.fromPromise({
      id: "wrapping-tool",
      async setup(context) {
        await context.tool.transform((editor) =>
          editor.update("guarded", (tool) => {
            const original = tool.execute
            tool.execute = (input, context) => original(input, context)
          }),
        )
      },
    }).effect(yield* PluginHost.make(plugins))

    const exit = yield* execute(yield* tools.snapshot(), "guarded")
    expect(Option.getOrUndefined(Exit.findErrorOption(exit))?.error).toBe(declined)
  }),
)

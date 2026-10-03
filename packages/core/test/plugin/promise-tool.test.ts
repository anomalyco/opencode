import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Tool } from "@opencode/core/tool"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import { testEffect } from "../lib/effect"
import { permissionLayer } from "../lib/permission"
import { PluginTestLayer, pluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const assertions: Permission.AssertInput[] = []
const permissionIt = testEffect(
  pluginTestLayer(
    permissionLayer({
      assert: (input) => Effect.sync(() => void assertions.push(input)),
    }),
  ),
)

permissionIt.effect("Promise metadata and executor updates authorize once with current actions", () =>
  Effect.gen(function* () {
    assertions.length = 0
    const plugins = yield* Plugin.Service
    const tools = yield* Tool.Service
    let executions = 0
    let originalReplacementExecutions = 0
    let replacementExecutions = 0
    const plugin = PluginPromise.fromPromise({
      id: "updated-promise-tool",
      async setup(context) {
        await context.tool.transform((editor) =>
          editor.add({
            name: "updated",
            description: "Original description",
            input: { type: "object", properties: {}, additionalProperties: false },
            options: { codemode: false, permission: "original-action" },
            execute: async () => {
              executions++
              return { content: "updated" }
            },
          }),
        )
        await context.tool.transform((editor) =>
          editor.add({
            name: "replaced",
            description: "Original executor",
            input: { type: "object", properties: {}, additionalProperties: false },
            options: { codemode: false, permission: "original-replacement-action" },
            execute: async () => {
              originalReplacementExecutions++
              return { content: "original" }
            },
          }),
        )
        await context.tool.transform((editor) =>
          editor.update("updated", (tool) => {
            tool.description = "Updated description"
            tool.options = { ...tool.options, permission: "intermediate-action" }
          }),
        )
        await context.tool.transform((editor) =>
          editor.update("updated", (tool) => {
            tool.options = { ...tool.options, permission: "current-action" }
          }),
        )
        await context.tool.transform((editor) =>
          editor.update("replaced", (tool) => {
            tool.options = { ...tool.options, permission: "replacement-action" }
            tool.execute = async () => {
              replacementExecutions++
              return { content: "replacement" }
            }
          }),
        )
      },
    })
    yield* plugins.activate([{ ...plugin, revision: "1", source: { type: "sdk" } }])

    const snapshot = yield* tools.snapshot()
    yield* snapshot.execute({
      sessionID: Session.ID.make("ses_promise_tool_permission"),
      agent: Agent.ID.make("build"),
      messageID: SessionMessage.ID.make("msg_promise_tool_permission"),
      call: { type: "tool-call", id: "call_promise_tool_permission", name: "updated", input: {} },
    })

    expect(assertions.map((input) => input.action)).toEqual(["current-action"])
    expect(executions).toBe(1)

    yield* snapshot.execute({
      sessionID: Session.ID.make("ses_promise_tool_permission"),
      agent: Agent.ID.make("build"),
      messageID: SessionMessage.ID.make("msg_promise_tool_permission"),
      call: { type: "tool-call", id: "call_promise_tool_replaced", name: "replaced", input: {} },
    })

    expect(assertions.map((input) => input.action)).toEqual(["current-action", "replacement-action"])
    expect(originalReplacementExecutions).toBe(0)
    expect(replacementExecutions).toBe(1)
  }),
)

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

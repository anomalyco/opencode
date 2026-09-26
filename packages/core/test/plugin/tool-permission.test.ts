import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { Session } from "@opencode/schema/session"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
import { testEffect } from "../lib/effect"
import { permissionLayer } from "../lib/permission"
import { pluginTestLayer } from "./fixture"

let assertion: Deferred.Deferred<Permission.AssertInput>
let decision: Effect.Effect<void, Permission.Error> = Effect.void
let assertions = 0

const it = testEffect(
  pluginTestLayer(
    permissionLayer({
      assert: (input) =>
        Effect.sync(() => assertions++).pipe(
          Effect.andThen(Deferred.succeed(assertion, input)),
          Effect.andThen(decision),
        ),
    }),
  ),
)

const identity = {
  sessionID: Session.ID.make("ses_plugin_tool_permission"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_plugin_tool_permission"),
}

it.effect("authorizes direct and Code Mode plugin tools at execution time", () =>
  Effect.gen(function* () {
    assertions = 0
    const plugins = yield* Plugin.Service
    const tools = yield* Tool.Service
    const executions: string[] = []
    let starts = 0
    yield* plugins.activate([
      {
        id: "permission-tools",
        revision: "1",
        source: { type: "sdk" },
        effect: (context) =>
          context.tool.transform((editor) => {
            editor.add({
              name: "direct",
              options: { codemode: false, permission: "configured-action" },
              description: "Direct plugin tool",
              input: { type: "object", properties: {}, additionalProperties: false },
              execute: () => {
                starts++
                return Effect.sync(() => {
                  executions.push("direct")
                  return { content: "direct" }
                })
              },
            })
            editor.add({
              name: "nested",
              options: { namespace: "demo" },
              description: "Code Mode plugin tool",
              input: { type: "object", properties: {}, additionalProperties: false },
              execute: () =>
                Effect.sync(() => {
                  executions.push("nested")
                  return { content: "nested" }
                }),
            })
          }),
      },
    ])
    const snapshot = yield* tools.snapshot()

    assertion = yield* Deferred.make<Permission.AssertInput>()
    const directPermission = yield* Deferred.make<void>()
    decision = Deferred.await(directPermission)
    const direct = yield* snapshot
      .execute({
        ...identity,
        call: { type: "tool-call", id: "call_plugin_direct", name: "direct", input: {} },
      })
      .pipe(Effect.forkScoped)
    expect(yield* Deferred.await(assertion)).toEqual({
      action: "configured-action",
      resources: ["*"],
      save: ["*"],
      metadata: {},
      sessionID: identity.sessionID,
      agent: identity.agent,
      source: { type: "tool", messageID: identity.messageID, id: "call_plugin_direct" },
    })
    expect(starts).toBe(0)
    expect(executions).toEqual([])
    yield* Deferred.succeed(directPermission, undefined)
    yield* Fiber.join(direct)
    expect(starts).toBe(1)

    assertion = yield* Deferred.make<Permission.AssertInput>()
    const nestedPermission = yield* Deferred.make<void>()
    decision = Deferred.await(nestedPermission)
    const nested = yield* snapshot
      .execute({
        ...identity,
        call: {
          type: "tool-call",
          id: "call_plugin_nested",
          name: "execute",
          input: { code: "return await tools.demo.nested({})" },
        },
      })
      .pipe(Effect.forkScoped)
    expect(yield* Deferred.await(assertion)).toEqual({
      action: "demo_nested",
      resources: ["*"],
      save: ["*"],
      metadata: {},
      sessionID: identity.sessionID,
      agent: identity.agent,
      source: { type: "tool", messageID: identity.messageID, id: "call_plugin_nested" },
    })
    expect(executions).toEqual(["direct"])
    yield* Deferred.succeed(nestedPermission, undefined)
    yield* Fiber.join(nested)
    expect(executions).toEqual(["direct", "nested"])
    expect(assertions).toBe(2)
  }),
)

it.effect("keeps executor and permission updates authorized once", () =>
  Effect.gen(function* () {
    assertions = 0
    const plugins = yield* Plugin.Service
    const tools = yield* Tool.Service
    let originalExecutions = 0
    let replacementStarts = 0
    let replacementExecutions = 0
    yield* plugins.activate([
      {
        id: "original-tool",
        revision: "1",
        source: { type: "sdk" },
        effect: (context) =>
          context.tool.transform((editor) =>
            editor.add({
              name: "updated",
              options: { codemode: false, permission: "original-action" },
              description: "Original tool",
              input: { type: "object", properties: {}, additionalProperties: false },
              execute: () =>
                Effect.sync(() => {
                  originalExecutions++
                  return { content: "original" }
                }),
            }),
          ),
      },
      {
        id: "updated-tool",
        revision: "1",
        source: { type: "sdk" },
        effect: (context) =>
          context.tool.transform((editor) =>
            editor.update("updated", (tool) => {
              tool.options = { ...tool.options, permission: "replacement-action" }
              tool.execute = () => {
                replacementStarts++
                return Effect.sync(() => {
                  replacementExecutions++
                  return { content: "replacement" }
                })
              }
            }),
          ),
      },
    ])
    const snapshot = yield* tools.snapshot()
    assertion = yield* Deferred.make<Permission.AssertInput>()
    const permission = yield* Deferred.make<void>()
    decision = Deferred.await(permission)
    const execution = yield* snapshot
      .execute({
        ...identity,
        call: { type: "tool-call", id: "call_plugin_updated", name: "updated", input: {} },
      })
      .pipe(Effect.forkScoped)

    expect(yield* Deferred.await(assertion)).toMatchObject({
      action: "replacement-action",
      source: { type: "tool", messageID: identity.messageID, id: "call_plugin_updated" },
    })
    expect(replacementStarts).toBe(0)
    expect(originalExecutions).toBe(0)
    expect(replacementExecutions).toBe(0)
    expect(assertions).toBe(1)

    yield* Deferred.succeed(permission, undefined)
    yield* Fiber.join(execution)
    expect(replacementStarts).toBe(1)
    expect(originalExecutions).toBe(0)
    expect(replacementExecutions).toBe(1)
    expect(assertions).toBe(1)
  }),
)

it.effect("preserves permission failures and does not wrap built-in tools", () =>
  Effect.gen(function* () {
    assertions = 0
    const plugins = yield* Plugin.Service
    const tools = yield* Tool.Service
    let executions = 0
    const definition = (source: Plugin.Source): Plugin.Generation => ({
      id: "permission-tool",
      revision: source.type,
      source,
      effect: (context) =>
        context.tool.transform((editor) =>
          editor.add({
            name: "permission_test",
            options: { codemode: false },
            description: "Permission test tool",
            input: { type: "object", properties: {}, additionalProperties: false },
            execute: () =>
              Effect.sync(() => {
                executions++
                return { content: "executed" }
              }),
          }),
        ),
    })

    yield* plugins.activate([definition({ type: "sdk" })])
    const external = yield* tools.snapshot()
    assertion = yield* Deferred.make<Permission.AssertInput>()
    decision = Effect.die(new Permission.DeclinedError())
    const declined = yield* external
      .execute({
        ...identity,
        call: { type: "tool-call", id: "call_plugin_declined", name: "permission_test", input: {} },
      })
      .pipe(Effect.exit)
    expect(Exit.isFailure(declined)).toBe(true)
    expect(
      Exit.isFailure(declined) &&
        declined.cause.reasons.some(
          (reason) => Cause.isDieReason(reason) && reason.defect instanceof Permission.DeclinedError,
        ),
    ).toBe(true)
    expect(executions).toBe(0)

    assertion = yield* Deferred.make<Permission.AssertInput>()
    decision = Effect.fail(new Permission.BlockedError({ rules: [], permission: "permission_test", resources: ["*"] }))
    const blocked = yield* external
      .execute({
        ...identity,
        call: { type: "tool-call", id: "call_plugin_blocked", name: "permission_test", input: {} },
      })
      .pipe(Effect.flip)
    expect(blocked).toBeInstanceOf(Tool.Error)
    expect(blocked.message).toBe("Permission denied: permission_test")
    expect(executions).toBe(0)

    assertion = yield* Deferred.make<Permission.AssertInput>()
    decision = Effect.fail(new Permission.CorrectedError({ feedback: "Use another tool" }))
    const corrected = yield* external
      .execute({
        ...identity,
        call: { type: "tool-call", id: "call_plugin_corrected", name: "permission_test", input: {} },
      })
      .pipe(Effect.flip)
    expect(corrected).toBeInstanceOf(Tool.Error)
    expect(corrected.message).toBe("Use another tool")
    expect(executions).toBe(0)

    yield* plugins.activate([
      definition({ type: "builtin" }),
      {
        id: "builtin-metadata",
        revision: "1",
        source: { type: "sdk" },
        effect: (context) =>
          context.tool.transform((editor) =>
            editor.update("permission_test", (tool) => {
              tool.description = "Updated built-in description"
            }),
          ),
      },
    ])
    decision = Effect.void
    const builtin = yield* tools.snapshot()
    yield* builtin.execute({
      ...identity,
      call: { type: "tool-call", id: "call_builtin", name: "permission_test", input: {} },
    })
    expect(executions).toBe(1)
    expect(assertions).toBe(3)
  }),
)

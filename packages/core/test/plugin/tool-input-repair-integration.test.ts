import { expect } from "bun:test"
import { Deferred, Effect, Schema } from "effect"
import { Agent } from "@opencode/core/agent"
import { Plugin } from "@opencode/core/plugin"
import { ToolInputRepairPlugin } from "@opencode/core/plugin/tool-input-repair"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const identity = {
  sessionID: Session.ID.make("ses_repair"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_repair"),
}

it.effect("repairs tool input before validating its original schema", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const executed: unknown[] = []
    yield* plugins.activate([
      { ...ToolInputRepairPlugin.Plugin, revision: "1" },
      {
        id: "repairable-tool",
        revision: "1",
        effect: (ctx) =>
          ctx.tool.transform((draft) =>
            draft.add({
              name: "repairable",
              options: { codemode: false },
              description: "Repairable",
              input: Schema.Struct({ count: Schema.Int, enabled: Schema.Boolean }),
              execute: (input) => Effect.sync(() => executed.push(input)).pipe(Effect.as({ content: "ok" })),
            }),
          ),
      },
    ])
    const snapshot = yield* registry.snapshot()
    yield* snapshot.execute({
      ...identity,
      call: {
        type: "tool-call",
        id: "call-repair",
        name: "repairable",
        input: '{"count":"2","enabled":"true","extra":true}',
      },
    })
    expect(executed).toEqual([{ count: 2, enabled: true }])

    yield* registry.transform((draft) => {
      draft.update("repairable", (tool) => {
        tool.input = Schema.Struct({ count: Schema.Boolean, enabled: Schema.Boolean })
      })
    })
    const updated = yield* registry.snapshot()
    yield* updated.execute({
      ...identity,
      call: {
        type: "tool-call",
        id: "call-updated",
        name: "repairable",
        input: { count: "false", enabled: "true" },
      },
    })
    expect(executed).toEqual([
      { count: 2, enabled: true },
      { count: false, enabled: true },
    ])

    yield* registry.transform((draft) => draft.remove("repairable"))
    const removed = yield* registry.snapshot()
    expect(
      (yield* removed
        .execute({
          ...identity,
          call: { type: "tool-call", id: "call-removed", name: "repairable", input: {} },
        })
        .pipe(Effect.flip)).message,
    ).toBe('No tool named "repairable" is currently available. Please use a tool from the available tool list.')
  }),
)

it.effect("runs a call to another harness's tool name as the matching tool and says so", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const executed: unknown[] = []
    yield* plugins.activate([
      { ...ToolInputRepairPlugin.Plugin, revision: "1" },
      {
        id: "shell-tool",
        revision: "1",
        effect: (ctx) =>
          ctx.tool.transform((draft) =>
            draft.add({
              name: "shell",
              options: { codemode: false },
              description: "Shell",
              input: Schema.Struct({ command: Schema.String, timeout: Schema.optionalKey(Schema.Int) }),
              execute: (input) => Effect.sync(() => executed.push(input)).pipe(Effect.as({ content: "done" })),
            }),
          ),
      },
    ])
    const snapshot = yield* registry.snapshot()
    const result = yield* snapshot.execute({
      ...identity,
      call: { type: "tool-call", id: "call-bash", name: "bash", input: { command: "ls", timeout: "5000" } },
    })
    expect(executed).toEqual([{ command: "ls", timeout: 5000 }])
    expect(result.content).toEqual([
      { type: "text", text: "done" },
      { type: "text", text: 'There is no "bash" tool, so this ran as "shell". Call "shell" directly.' },
    ])

    const direct = yield* snapshot.execute({
      ...identity,
      call: { type: "tool-call", id: "call-shell", name: "shell", input: { command: "pwd" } },
    })
    expect(direct.content).toEqual([{ type: "text", text: "done" }])
  }),
)

it.effect("repairs namespaced inner tool input called from Code Mode", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const executed: unknown[] = []
    yield* plugins.activate([{ ...ToolInputRepairPlugin.Plugin, revision: "1" }])
    yield* registry.transform((draft) =>
      draft.add({
        name: "count",
        options: { namespace: "example" },
        description: "Record a count",
        input: Schema.Struct({ count: Schema.Int }),
        execute: (input) => Effect.sync(() => executed.push(input)).pipe(Effect.as({ content: "ok" })),
      }),
    )

    const snapshot = yield* registry.snapshot()
    yield* snapshot.execute({
      ...identity,
      call: {
        type: "tool-call",
        id: "call-codemode-repair",
        name: "execute",
        input: { code: 'return await tools.example.count({ count: "3" })' },
      },
    })
    expect(executed).toEqual([{ count: 3 }])
  }),
)

it.effect("passes JSON-looking freeform text through repair as a string field", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    yield* plugins.activate([{ ...ToolInputRepairPlugin.Plugin, revision: "1" }])
    yield* registry.transform((draft) =>
      draft.add({
        name: "send",
        description: "Echo text",
        freeform: { type: "text" },
        input: Schema.Struct({ text: Schema.String }),
        execute: ({ text }) => Effect.succeed({ content: text }),
      }),
    )
    const result = yield* program(yield* registry.snapshot(), `return await tools.send('{"count":"3"}')`)
    expect(result.output).toMatchObject({ output: '{"count":"3"}' })
  }),
)

function program(snapshot: Tool.Snapshot, code: string) {
  return snapshot.execute({
    ...identity,
    call: { type: "tool-call", id: "call-program", name: "execute", input: { code } },
  })
}

const redirected = Effect.gen(function* () {
  const plugins = yield* Plugin.Service
  const registry = yield* Tool.Service
  const before: string[] = []
  const executed: string[] = []
  yield* plugins.activate([
    {
      id: "redirect-tool",
      revision: "1",
      effect: (ctx) =>
        ctx.tool.hook("execute.before", (event) =>
          Effect.sync(() => {
            if (event.tool === "execute") return
            before.push(event.tool)
            if (event.tool !== "example.missing" && event.tool !== "example_original") return
            event.tool = "example_target"
            event.input = { count: 7 }
          }),
        ),
    },
  ])
  yield* registry.transform((draft) => {
    for (const name of ["original", "target"]) {
      draft.add({
        name,
        options: { namespace: "example" },
        description: name,
        input: Schema.Struct({ count: Schema.Int }),
        execute: ({ count }, ctx) =>
          Effect.sync(() => {
            executed.push(name)
            return { content: `${ctx.id}:${count}` }
          }),
      })
    }
  })
  return { registry, snapshot: yield* registry.snapshot(), before, executed }
})

for (const [path, hookName] of [
  ["example.missing", "example.missing"],
  ["example.original", "example_original"],
]) {
  it.effect(`redirects tools.${path} to a visible namespaced target before validation`, () =>
    Effect.gen(function* () {
      const fixture = yield* redirected
      const result = yield* program(fixture.snapshot, `return await tools.${path}({})`)
      expect(result.output).toMatchObject({ output: "call-program:7" })
      expect(result.metadata).toEqual({
        toolCalls: [{ tool: "example.target", input: { count: 7 }, status: "completed" }],
      })
      expect(fixture.before).toEqual([hookName])
      expect(fixture.executed).toEqual(["target"])
    }),
  )
}

it.effect("records an unknown underscore spelling when the program catches the lookup error", () =>
  Effect.gen(function* () {
    const fixture = yield* redirected
    const result = yield* program(
      fixture.snapshot,
      "try { await tools.example_target({ count: 4 }) } catch (e) { return e.message }",
    )
    expect(result.output).toMatchObject({
      output: expect.stringContaining("Unknown tool 'example_target'"),
    })
    expect(result.metadata).toEqual({ toolCalls: [{ tool: "example_target", input: { count: 4 }, status: "error" }] })
    expect(fixture.before).toEqual(["example_target"])
    expect(fixture.executed).toEqual([])
  }),
)

it.effect("a program can catch a plugin veto and return successfully with one failed tool call", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    yield* plugins.activate([
      {
        id: "deny-tool",
        revision: "1",
        effect: (ctx) =>
          ctx.tool.hook("execute.before", (event) =>
            event.tool === "blocked" ? Effect.fail(new Tool.Error({ message: "denied by plugin" })) : Effect.void,
          ),
      },
    ])
    const executed: unknown[] = []
    yield* registry.transform((draft) =>
      draft.add({
        name: "blocked",
        description: "Blocked tool",
        input: Schema.Struct({ value: Schema.Int }),
        execute: (input) => Effect.sync(() => executed.push(input)).pipe(Effect.as({ content: "unexpected" })),
      }),
    )
    const result = yield* program(
      yield* registry.snapshot(),
      "try { await tools.blocked({ value: 2 }) } catch (e) { return e.message }",
    )
    expect(result.output).toMatchObject({ output: expect.stringContaining("denied by plugin") })
    expect(result.metadata).toEqual({ toolCalls: [{ tool: "blocked", input: { value: 2 }, status: "error" }] })
    expect(executed).toEqual([])
  }),
)

it.effect("rejects a redirect outside a scheduled check's allowlist", () =>
  Effect.gen(function* () {
    const fixture = yield* redirected
    const result = yield* fixture.registry.check({
      code: "return await tools.example.original({ count: 1 })",
      tools: ["example.original"],
      bindings: {},
      permissions: [],
      limits: {},
      context: { ...identity, progress: () => Effect.void },
    })
    expect(result.ok).toBe(false)
    expect(fixture.before).toEqual(["example_original"])
    expect(fixture.executed).toEqual([])
  }),
)

it.effect("keeps a direct-only shell hidden from Code Mode alias repair", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const executed: string[] = []
    yield* plugins.activate([{ ...ToolInputRepairPlugin.Plugin, revision: "1" }])
    yield* registry.transform((draft) =>
      draft.add({
        name: "shell",
        options: { codemode: false },
        description: "Shell",
        input: Schema.Struct({ command: Schema.String }),
        execute: ({ command }) => Effect.sync(() => executed.push(command)).pipe(Effect.as({ content: "done" })),
      }),
    )
    const result = yield* program(yield* registry.snapshot(), 'return await tools.bash({ command: "pwd" })')
    expect(result.output).toMatchObject({ error: true })
    expect(executed).toEqual([])
  }),
)

it.effect("keeps parallel text results clean and reports the alias on the outer execute result", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const siblingFinished = yield* Deferred.make<void>()
    yield* plugins.activate([
      { ...ToolInputRepairPlugin.Plugin, revision: "1" },
      {
        id: "wait-for-sibling",
        revision: "1",
        effect: (ctx) =>
          ctx.tool.hook("execute.before", (event) =>
            event.tool === "shell" ? Deferred.await(siblingFinished) : Effect.void,
          ),
      },
    ])
    yield* registry.transform((draft) => {
      draft.add({
        name: "shell",
        description: "Shell",
        input: Schema.Struct({}),
        execute: () => Effect.succeed({ content: "shell text" }),
      })
      draft.add({
        name: "sibling",
        description: "Sibling",
        input: Schema.Struct({}),
        execute: () => Deferred.succeed(siblingFinished, undefined).pipe(Effect.as({ content: "sibling text" })),
      })
    })
    const snapshot = yield* registry.snapshot()
    const result = yield* program(snapshot, "return await Promise.all([tools.bash({}), tools.sibling({})])")
    expect(result.output).toMatchObject({ output: '["shell text","sibling text"]' })
    expect(result.metadata).toEqual({
      toolCalls: [
        { tool: "shell", status: "completed" },
        { tool: "sibling", status: "completed" },
      ],
    })
    expect(result.content).toContainEqual({
      type: "text",
      text: 'There is no "bash" tool, so this ran as "shell". Call "shell" directly.',
    })
    const direct = yield* program(snapshot, "return await tools.shell({})")
    expect(direct.content).toEqual([{ type: "text", text: "shell text" }])
  }),
)

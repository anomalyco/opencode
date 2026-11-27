import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { Agent } from "@opencode/core/agent"
import { Plugin } from "@opencode/core/plugin"
import { ToolInputRepairPlugin } from "@opencode/core/plugin/tool-input-repair"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { ShellTool } from "@opencode/core/tool/plugin/shell"
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

it.effect("runs a call to another harness's tool name as the matching Code Mode tool", () =>
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
              description: "Shell",
              input: Schema.Struct({ command: Schema.String, timeout: Schema.optionalKey(Schema.Int) }),
              execute: (input) => Effect.sync(() => executed.push(input)).pipe(Effect.as({ content: "done" })),
            }),
          ),
      },
    ])
    // shell is only offered inside Code Mode, so the renamed call runs as the program that calls it.
    const snapshot = yield* registry.snapshot()
    const result = yield* snapshot.execute({
      ...identity,
      call: { type: "tool-call", id: "call-bash", name: "bash", input: { command: "ls", timeout: "5000" } },
    })
    expect(executed).toEqual([{ command: "ls", timeout: 5000 }])
    expect(result.content[0]).toEqual({
      type: "text",
      text: '<tool-repair>\nThere is no "bash" tool, so this ran inside execute as tools.shell(input). Call it there next time.\n</tool-repair>',
    })
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
      {
        type: "text",
        text: '<tool-repair>\nThere is no "bash" tool, so this ran as "shell". Call "shell" next time.\n</tool-repair>',
      },
      { type: "text", text: "done" },
    ])

    const direct = yield* snapshot.execute({
      ...identity,
      call: { type: "tool-call", id: "call-shell", name: "shell", input: { command: "pwd" } },
    })
    expect(direct.content).toEqual([{ type: "text", text: "done" }])

    // A call rejected before it runs leaves no note behind for a later call with the same ID.
    yield* snapshot
      .execute({
        ...identity,
        call: { type: "tool-call", id: "call-reused", name: "bash", input: { command: "ls" } },
        definitions: new Map(),
      })
      .pipe(Effect.flip)
    const reused = yield* snapshot.execute({
      ...identity,
      call: { type: "tool-call", id: "call-reused", name: "shell", input: { command: "pwd" } },
    })
    expect(reused.content).toEqual([{ type: "text", text: "done" }])
  }),
)

it.effect("runs a top-level call to a Code Mode tool and says to call it inside execute", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    yield* plugins.activate([
      { ...ToolInputRepairPlugin.Plugin, revision: "1" },
      {
        id: "acme-tools",
        revision: "1",
        effect: (ctx) =>
          ctx.tool.transform((draft) => {
            draft.add({
              name: "echo",
              options: { namespace: "acme" },
              description: "Echo",
              input: Schema.Struct({ text: Schema.String }),
              execute: ({ text }) => Effect.succeed({ content: text }),
            })
            draft.add({
              name: "fails",
              options: { namespace: "acme" },
              description: "Fails",
              input: Schema.Struct({}),
              execute: () => Effect.fail(new Tool.Error({ message: "boom" })),
            })
          }),
      },
    ])
    const snapshot = yield* registry.snapshot()
    const note = (path: string) =>
      `<tool-repair>\nacme.${path} is a Code Mode tool, so this ran inside execute as tools.acme.${path}(input). Call it there next time.\n</tool-repair>`
    const result = yield* snapshot.execute({
      ...identity,
      call: { type: "tool-call", id: "call-echo", name: "acme.echo", input: { text: "hi" } },
    })
    expect(result.content[0]).toEqual({ type: "text", text: note("echo") })
    // A failing program fails the call, with the note first.
    const failed = yield* snapshot
      .execute({ ...identity, call: { type: "tool-call", id: "call-fails", name: "acme.fails", input: {} } })
      .pipe(Effect.flip)
    expect(failed.message.startsWith(note("fails"))).toBe(true)
    expect(failed.message).toContain("boom")
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

it.effect("repairs nested Code Mode calls against the Code Mode input schema", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const executed: unknown[] = []
    yield* plugins.activate([{ ...ToolInputRepairPlugin.Plugin, revision: "1" }])
    yield* registry.transform((draft) =>
      draft.add({
        name: "inspect",
        description: "Inspect",
        input: Schema.Struct({ count: Schema.Int }),
        options: {
          codemode: {
            input: Schema.Struct({ count: Schema.Int, detail: Schema.optionalKey(Schema.Boolean) }),
          },
        },
        execute: (input) => Effect.sync(() => executed.push(input)).pipe(Effect.as({ content: "ok" })),
      }),
    )

    const inCodeMode = yield* registry.snapshot()
    yield* inCodeMode.execute({
      ...identity,
      call: {
        type: "tool-call",
        id: "call-codemode-dynamic",
        name: "execute",
        input: { code: 'return await tools.inspect({ count: "3", detail: "true", extra: true })' },
      },
    })
    const direct = yield* registry.snapshot(undefined, { tools: { direct: new Set(["inspect"]) } })
    yield* direct.execute({
      ...identity,
      call: {
        type: "tool-call",
        id: "call-direct-dynamic",
        name: "inspect",
        input: { count: "4", detail: true },
      },
    })
    expect(executed).toEqual([{ count: 3, detail: true }, { count: 4 }])
  }),
)

it.effect("keeps undeclared keys when a required key is missing so the error shows them", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const executed: unknown[] = []
    yield* plugins.activate([
      { ...ToolInputRepairPlugin.Plugin, revision: "1" },
      {
        id: "edit-tool",
        revision: "1",
        effect: (ctx) =>
          ctx.tool.transform((draft) =>
            draft.add({
              name: "edit",
              options: { codemode: false },
              description: "Edit",
              input: Schema.Struct({ path: Schema.String, oldString: Schema.String, newString: Schema.String }),
              execute: (input) => Effect.sync(() => executed.push(input)).pipe(Effect.as({ content: "ok" })),
            }),
          ),
      },
    ])
    const snapshot = yield* registry.snapshot()
    const failed = yield* snapshot
      .execute({
        ...identity,
        call: {
          type: "tool-call",
          id: "call-wrong-keys",
          name: "edit",
          input: { path: "a.ts", old_string: "a", new_string: "b" },
        },
      })
      .pipe(Effect.flip)
    expect(failed.message).toContain("oldString")
    expect(failed.message).toContain("old_string")
    expect(failed.message).toContain("new_string")

    yield* snapshot.execute({
      ...identity,
      call: {
        type: "tool-call",
        id: "call-extra-key",
        name: "edit",
        input: { path: "a.ts", oldString: "a", newString: "b", extra: true },
      },
    })
    expect(executed).toEqual([{ path: "a.ts", oldString: "a", newString: "b" }])
  }),
)

it.effect("fails a Code Mode shell call with keys its input doesn't take instead of dropping them", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const executed: unknown[] = []
    yield* plugins.activate([{ ...ToolInputRepairPlugin.Plugin, revision: "1" }])
    yield* registry.transform((draft) =>
      draft.add({
        name: ShellTool.name,
        description: "Shell",
        input: ShellTool.Input,
        options: { codemode: { input: ShellTool.CodeModeInput } },
        execute: (input) => Effect.sync(() => executed.push(input)).pipe(Effect.as({ content: "ok" })),
      }),
    )
    const snapshot = yield* registry.snapshot()
    const run = (id: string, input: object) =>
      snapshot
        .execute({
          ...identity,
          call: {
            type: "tool-call",
            id,
            name: "execute",
            input: {
              code: `try { return await tools.shell(${JSON.stringify(input)}) } catch (e) { return String(e.message ?? e) }`,
            },
          },
        })
        .pipe(
          Effect.map((result) =>
            result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
          ),
        )

    const timeout = yield* run("call-shell-timeout", { command: "make", timeout: 600_000 })
    expect(timeout).toContain(
      [
        "<tool-repair>",
        "tools.shell takes only `command` and `workdir` in Code Mode, so this call did not run.",
        "`timeout` isn't supported here; the command runs until it exits. Use `timeout N <command>` to bound it.",
        "</tool-repair>",
      ].join("\n"),
    )
    const others = yield* run("call-shell-others", { command: "make", background: true, yield_ms: 1000, nohup: 1 })
    expect(others).toContain(
      [
        "tools.shell takes only `command` and `workdir` in Code Mode, so this call did not run.",
        "`background` isn't supported here; the command runs until it exits. execute's `background` option runs a whole script in the background.",
        "`yield_ms`, `nohup` isn't supported here.",
      ].join("\n"),
    )
    expect(executed).toEqual([])

    // A key that changes nothing about the command is dropped.
    yield* run("call-shell-plain", { command: "make", workdir: "/tmp", description: "Build" })
    expect(executed).toEqual([{ command: "make", workdir: "/tmp" }])

    // The direct shell still takes `timeout` and `background`.
    const direct = yield* registry.snapshot(undefined, { tools: { direct: new Set([ShellTool.name]) } })
    yield* direct.execute({
      ...identity,
      call: {
        type: "tool-call",
        id: "call-direct-shell",
        name: ShellTool.name,
        input: { command: "make", timeout: 600_000, background: true, extra: 1 },
      },
    })
    expect(executed).toEqual([
      { command: "make", workdir: "/tmp" },
      { command: "make", timeout: 600_000, background: true },
    ])
  }),
)

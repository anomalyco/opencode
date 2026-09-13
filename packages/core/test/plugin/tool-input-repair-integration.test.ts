import { expect } from "bun:test"
import { Effect, Schema } from "effect"
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
    ).toBe("Unknown tool: repairable")
  }),
)

it.effect("repairs outer Code Mode input and looks up namespaced inner tool schemas", () =>
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
        input: JSON.stringify({ code: 'return await tools.example.count({ count: "3" })' }),
      },
    })
    expect(executed).toEqual([{ count: 3 }])
  }),
)

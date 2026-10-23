import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Tool } from "@opencode/core/tool"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.effect("keeps default Promise plugin tools in Code Mode", () =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const tools = yield* Tool.Service
    const executed: string[] = []
    yield* PluginPromise.fromPromise({
      id: "codemode-tool",
      async setup(ctx) {
        await ctx.tool.transform((editor) =>
          editor.add({
            name: "probe",
            description: "Record an invocation",
            input: { type: "object", properties: {}, additionalProperties: false },
            async execute() {
              executed.push("probe")
              return { content: "ran" }
            },
          }),
        )
      },
    }).effect(yield* PluginHost.make(plugins))

    const snapshot = yield* tools.snapshot()
    expect(snapshot.definitions.map((tool) => tool.name)).toEqual(["execute"])
    const identity = {
      sessionID: Session.ID.make("ses_default_tool"),
      agent: Agent.ID.make("build"),
      messageID: SessionMessage.ID.make("msg_default_tool"),
    }
    for (const name of ["probe", "tools.probe"]) {
      const error = yield* snapshot
        .execute({
          ...identity,
          call: { type: "tool-call", id: `call-${name}`, name, input: {} },
        })
        .pipe(Effect.flip)
      expect(error.message).toContain(`No tool named "${name}"`)
    }
    expect(executed).toEqual([])
    yield* snapshot.execute({
      ...identity,
      call: {
        type: "tool-call",
        id: "call-code",
        name: "execute",
        input: { code: "return await tools.probe({})" },
      },
    })
    expect(executed).toEqual(["probe"])
  }),
)

for (const namespace of [undefined, "acme"]) {
  it.effect(`calls a Promise plugin tool directly with execute denied (namespace: ${namespace})`, () =>
    Effect.gen(function* () {
      const plugins = yield* Plugin.Service
      const tools = yield* Tool.Service
      const executed: string[] = []
      yield* PluginPromise.fromPromise({
        id: "direct-tool",
        async setup(ctx) {
          await ctx.tool.transform((editor) =>
            editor.add({
              name: "probe",
              description: "Record an invocation",
              input: { type: "object", properties: {}, additionalProperties: false },
              options: { namespace, codemode: false },
              async execute() {
                executed.push("probe")
                return { content: "ran" }
              },
            }),
          )
        },
      }).effect(yield* PluginHost.make(plugins))

      const name = namespace ? `${namespace}_probe` : "probe"
      expect((yield* tools.list()).map((tool) => tool.name)).toContain("probe")
      const snapshot = yield* tools.snapshot([{ action: "execute", resource: "*", effect: "deny" }])
      expect(snapshot.definitions.map((tool) => tool.name)).toEqual([name])
      expect(snapshot.codeModeCatalog).toBeUndefined()
      yield* snapshot.execute({
        sessionID: Session.ID.make("ses_direct_tool"),
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.make("msg_direct_tool"),
        call: { type: "tool-call", id: "call-direct", name, input: {} },
      })
      expect(executed).toEqual(["probe"])
      const denied = yield* tools.snapshot([
        { action: "execute", resource: "*", effect: "deny" },
        { action: name, resource: "*", effect: "deny" },
      ])
      expect(denied.definitions).toEqual([])
    }),
  )
}

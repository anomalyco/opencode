import { describe, expect } from "bun:test"
import { Effect, Layer, Schema, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { AdvisorPlugin } from "@opencode/core/plugin/advisor"
import { Session } from "@opencode/core/session"
import { SessionGenerate } from "@opencode/core/session/generate"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionUsage } from "@opencode/core/session/usage"
import { Tool } from "@opencode/core/tool"
import { Advisor } from "@opencode/schema/advisor"
import { Document, Info, type Entry } from "@opencode/schema/config"
import { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolDefinitions, toolIdentity, toolNodeReplacements } from "./lib/tool"

const sessionID = Session.ID.make("ses_advisor_tool_test")
const full: Advisor.State = { mode: "full", model: { providerID: "p", id: "m" } }
const secure: Advisor.State = { mode: "secure", model: { providerID: "p", id: "m" } }

type GenerateInput = Parameters<Session.Interface["generate"]>[0]
const calls: GenerateInput[] = []
let reply: (
  input: GenerateInput,
) => Effect.Effect<SessionGenerate.Result, SessionRunnerModel.ModelUnavailableError> = () => Effect.die("unused reply")
type Handlers = {
  readonly get: (input: {}) => Effect.Effect<Advisor.State | null, unknown>
  readonly set: (next: Advisor.State) => Effect.Effect<Advisor.State | null, unknown>
}
let captured: Handlers | undefined
const rpc = () => (captured ? Effect.succeed(captured) : Effect.die("rpc was not registered"))

const zeroUsage = SessionUsage.record(undefined, [])
type Request = {
  tools: Record<string, { description: string; input: Record<string, unknown> }>
  system: Array<{ text: string }>
}
let contextHook: ((event: Request) => Effect.Effect<void>) | undefined
// Runs the context hook on a request carrying the registered tool, as the runner would.
const request = (registry: Tool.Interface) =>
  Effect.gen(function* () {
    const definition = yield* find(registry)
    const event: Request = {
      tools: definition
        ? {
            [definition.name]: {
              description: definition.description,
              input: structuredClone(definition.inputSchema) as Record<string, unknown>,
            },
          }
        : {},
      system: [],
    }
    if (contextHook) yield* contextHook(event)
    return { tool: event.tools[AdvisorPlugin.name], system: event.system.map((part) => part.text) }
  })

const sessions = Layer.mock(Session.Service)({
  generate: (input) =>
    Effect.suspend(() => {
      calls.push(input)
      return reply(input)
    }),
  revert: {
    stage: () => Effect.die("unused session.revert.stage"),
    clear: () => Effect.die("unused session.revert.clear"),
    commit: () => Effect.die("unused session.revert.commit"),
  },
})

const it = testEffect(AppNodeBuilder.build(Tool.node, toolNodeReplacements()))

const setup = (experimental: ConfigExperimental.Info | undefined, initial: Advisor.State) =>
  Effect.gen(function* () {
    const map = new Map<string, Schema.Json>([["state", initial as Schema.Json]])
    yield* registerToolPlugin(AdvisorPlugin.Plugin, {
      event: { subscribe: () => Stream.never },
      storage: {
        get: (key) => Effect.succeed(map.get(key)),
        set: (key, value) => Effect.sync(() => void map.set(key, value)),
        remove: (key) => Effect.sync(() => void map.delete(key)),
        scan: () => Effect.succeed({ entries: [] }),
      },
      rpc: Object.assign(
        () => {
          throw new Error("unused rpc.client")
        },
        {
          // SAFETY: the advisor plugin registers one RPC, whose `get` and `set` handlers these tests call.
          register: ((_definition: unknown, handlers: NonNullable<typeof captured>) =>
            Effect.sync(() => {
              captured = handlers
              return { dispose: Effect.void, events: { emit: () => Effect.void } }
            })) as never,
        },
      ),
      session: {
        hook: (name, callback) =>
          Effect.sync(() => {
            if (name === "context") contextHook = callback as typeof contextHook
            return { dispose: Effect.void }
          }),
      },
    }).pipe(
      Effect.provide(Flag.testLayer([document(experimental)])),
      Effect.provide(permissionLayer({ assert: () => Effect.void })),
      Effect.provide(sessions),
    )
    return { registry: yield* Tool.Service, map }
  })

const names = (registry: Tool.Interface) =>
  toolDefinitions(registry).pipe(Effect.map((definitions) => definitions.map((definition) => definition.name)))

const find = (registry: Tool.Interface) =>
  toolDefinitions(registry).pipe(
    Effect.map((definitions) => definitions.find((tool) => tool.name === AdvisorPlugin.name)),
  )

const run = (registry: Tool.Interface, input: Record<string, unknown>) =>
  executeTool(registry, {
    sessionID,
    ...toolIdentity,
    call: { type: "tool-call", id: "call-advisor", name: AdvisorPlugin.name, input },
  })

describe("AdvisorPlugin", () => {
  it.effect("is absent unless the advisor flag is on, and the RPC reports it disabled", () =>
    Effect.gen(function* () {
      const { registry, map } = yield* setup(undefined, full)
      expect(yield* names(registry)).not.toContain(AdvisorPlugin.name)
      const handlers = yield* rpc()
      expect(yield* Effect.orDie(handlers.get({}))).toBeNull()
      expect(yield* Effect.orDie(handlers.set(secure))).toBeNull()
      expect(map.get("state")).toEqual(full)
      expect(
        yield* names((yield* setup(new ConfigExperimental.Info({ advisor: false }), full)).registry),
      ).not.toContain(AdvisorPlugin.name)
    }),
  )

  it.effect("off removes the tool and adds nothing to the request", () =>
    Effect.gen(function* () {
      const { registry } = yield* setup(new ConfigExperimental.Info({ advisor: true }), { mode: "off" })
      expect(yield* request(registry)).toMatchObject({ system: [] })
      expect((yield* request(registry)).tool).toBeUndefined()
    }),
  )

  it.effect("full mode asks only for a question and sends the transcript", () =>
    Effect.gen(function* () {
      calls.length = 0
      reply = () => Effect.succeed({ text: "Solid advice.", ...zeroUsage })
      const { registry } = yield* setup(new ConfigExperimental.Info({ advisor: true }), full)
      const shown = yield* request(registry)
      expect(shown.tool?.description).toContain("p/m")
      expect(shown.tool?.input).toHaveProperty("required", ["question"])
      expect(shown.tool?.input).not.toHaveProperty("properties.context")
      expect(shown.system).toHaveLength(1)
      expect(shown.system[0]).toContain("It sees this conversation")
      const result = yield* run(registry, { question: "Is <x> safe?" })
      expect(calls).toHaveLength(1)
      expect(calls[0]?.toolChoice).toBe("none")
      expect(calls[0]?.transcript).toBe(true)
      expect(String(calls[0]?.model?.providerID)).toBe("p")
      expect(String(calls[0]?.model?.id)).toBe("m")
      expect(calls[0]?.prompt).toContain("The conversation above")
      expect(calls[0]?.prompt).toContain("<question>\nIs &lt;x&gt; safe?\n</question>")
      expect(calls[0]?.prompt).not.toContain("${situation}")
      expect(result.status).toBe("completed")
      expect(result.content).toEqual([{ type: "text", text: "Solid advice." }])
      expect(result.metadata).toEqual({ model: "p/m", mode: "full", status: "reviewed" })
    }),
  )

  it.effect("secure mode asks for a brief and sends only that", () =>
    Effect.gen(function* () {
      calls.length = 0
      reply = () => Effect.succeed({ text: "Solid advice.", ...zeroUsage })
      const { registry } = yield* setup(new ConfigExperimental.Info({ advisor: true }), secure)
      const shown = yield* request(registry)
      expect(shown.tool?.input).toHaveProperty("required", ["question", "context"])
      expect(shown.system[0]).toContain("(p/m)")
      expect(shown.system[0]).toContain("never sees this conversation")
      yield* run(registry, { question: "Q <b>", context: "C & D" })
      expect(calls).toHaveLength(1)
      expect(calls[0]?.transcript).toBe(false)
      expect(calls[0]?.prompt).toContain("You cannot see the agent's conversation")
      expect(calls[0]?.prompt).toContain("Q &lt;b&gt;")
      expect(calls[0]?.prompt).toContain("C &amp; D")
    }),
  )

  it.effect("reports a decline instead of echoing it", () =>
    Effect.gen(function* () {
      calls.length = 0
      reply = () => Effect.succeed({ text: "DECLINE", ...zeroUsage })
      const { registry } = yield* setup(new ConfigExperimental.Info({ advisor: true }), full)
      const result = yield* run(registry, { question: "Q" })
      expect(result.metadata).toEqual({ model: "p/m", mode: "full", status: "declined" })
      expect(result.content).toEqual([{ type: "text", text: "The advisor had nothing to add." }])
    }),
  )

  it.effect("fails as unavailable when the advisor model cannot be resolved", () =>
    Effect.gen(function* () {
      calls.length = 0
      reply = () =>
        Effect.fail(
          new SessionRunnerModel.ModelUnavailableError({
            providerID: Provider.ID.make("p"),
            modelID: Model.ID.make("m"),
          }),
        )
      const { registry } = yield* setup(new ConfigExperimental.Info({ advisor: true }), full)
      const result = yield* run(registry, { question: "Q" })
      expect(result.status).toBe("error")
      expect(result.error?.message).toBe("Advisor unavailable: Model unavailable: p/m. Continue without advice.")
    }),
  )

  it.effect("a change saved anywhere applies to the next request and call", () =>
    Effect.gen(function* () {
      calls.length = 0
      reply = () => Effect.succeed({ text: "Solid advice.", ...zeroUsage })
      const { registry, map } = yield* setup(new ConfigExperimental.Info({ advisor: true }), full)
      // Another Location writes the shared storage; this copy of the plugin never sees its `set`.
      map.set("state", secure)
      expect((yield* request(registry)).tool?.input).toHaveProperty("required", ["question", "context"])
      yield* run(registry, { question: "Q", context: "C" })
      expect(calls[0]?.transcript).toBe(false)
      map.set("state", { mode: "off" })
      expect(yield* request(registry)).toMatchObject({ system: [] })
      expect((yield* request(registry)).tool).toBeUndefined()
      const result = yield* run(registry, { question: "Q" })
      expect(result.status).toBe("error")
      expect(result.error?.message).toBe("The advisor is off.")
      expect(calls).toHaveLength(1)
    }),
  )

  it.effect("the RPC saves the setting and reads it back", () =>
    Effect.gen(function* () {
      const { map } = yield* setup(new ConfigExperimental.Info({ advisor: true }), { mode: "off" })
      const handlers = yield* rpc()
      expect(yield* Effect.orDie(handlers.set(secure))).toEqual(secure)
      expect(map.get("state")).toEqual(secure)
      expect(yield* Effect.orDie(handlers.get({}))).toEqual(secure)
    }),
  )
})

function document(experimental: ConfigExperimental.Info | undefined): Entry {
  return new Document({ type: "document", info: new Info(experimental ? { experimental } : {}) })
}

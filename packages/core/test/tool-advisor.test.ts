import { describe, expect } from "bun:test"
import { Effect, Layer, Schema, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Flag } from "@opencode/core/flag"
import { AdvisorPlugin } from "@opencode/core/plugin/advisor"
import type { Context } from "@opencode/plugin/effect/plugin"
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
let captured: { readonly set: (next: Advisor.State) => Effect.Effect<Advisor.State, unknown> } | undefined

const zeroUsage = SessionUsage.record(undefined, [])
let contextHook:
  | ((event: { tools: Record<string, unknown>; system: Array<{ text: string }> }) => Effect.Effect<void>)
  | undefined
const systemFor = (tools: Record<string, unknown>) =>
  Effect.gen(function* () {
    const event = { tools, system: [] as Array<{ text: string }> }
    if (contextHook) yield* contextHook(event)
    return event.system.map((part) => part.text)
  })

const rpcMock = Object.assign(
  () => {
    throw new Error("unused rpc.client")
  },
  {
    register: (
      _definition: unknown,
      handlers: { readonly set: (next: Advisor.State) => Effect.Effect<Advisor.State, unknown> },
    ) =>
      Effect.sync(() => {
        captured = handlers
        return { dispose: Effect.void, events: { emit: () => Effect.void } }
      }),
  },
)

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
      rpc: rpcMock as unknown as Context["rpc"],
      session: {
        hook: (name: string, handler: unknown) =>
          Effect.sync(() => {
            if (name === "context") contextHook = handler as typeof contextHook
            return { dispose: Effect.void }
          }),
      } as unknown as Context["session"],
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
  it.effect("is absent unless the advisor flag is on", () =>
    Effect.gen(function* () {
      expect(yield* names((yield* setup(undefined, full)).registry)).not.toContain(AdvisorPlugin.name)
      expect(
        yield* names((yield* setup(new ConfigExperimental.Info({ advisor: false }), full)).registry),
      ).not.toContain(AdvisorPlugin.name)
    }),
  )

  it.effect("is absent while the advisor is off", () =>
    Effect.gen(function* () {
      expect(
        yield* names((yield* setup(new ConfigExperimental.Info({ advisor: true }), { mode: "off" })).registry),
      ).not.toContain(AdvisorPlugin.name)
    }),
  )

  it.effect("full mode consults with the session transcript and no tools of its own to choose", () =>
    Effect.gen(function* () {
      calls.length = 0
      reply = () => Effect.succeed({ text: "Solid advice.", ...zeroUsage })
      const { registry } = yield* setup(new ConfigExperimental.Info({ advisor: true }), full)
      const definition = yield* find(registry)
      expect(definition?.inputSchema).toHaveProperty("required", ["question"])
      expect(definition?.description).toContain("p/m")
      const result = yield* run(registry, { question: "Which approach?" })
      expect(calls).toHaveLength(1)
      expect(calls[0]?.toolChoice).toBe("none")
      expect(calls[0]?.transcript).toBe(true)
      const ref = calls[0]?.model
      expect(String(ref?.providerID)).toBe("p")
      expect(String(ref?.id)).toBe("m")
      expect(calls[0]?.prompt).toContain("The conversation above")
      expect(calls[0]?.prompt).not.toContain("${situation}")
      expect(result.status).toBe("completed")
      expect(result.content).toEqual([{ type: "text", text: "Solid advice." }])
      expect(result.metadata).toEqual({ model: "p/m", mode: "full", status: "reviewed" })
    }),
  )

  it.effect("full mode forwards the executor's escaped question", () =>
    Effect.gen(function* () {
      calls.length = 0
      reply = () => Effect.succeed({ text: "Solid advice.", ...zeroUsage })
      const { registry } = yield* setup(new ConfigExperimental.Info({ advisor: true }), full)
      yield* run(registry, { question: "Is <x> safe?" })
      expect(calls).toHaveLength(1)
      expect(calls[0]?.prompt).toContain("<question>\nIs &lt;x&gt; safe?\n</question>")
      expect(calls[0]?.prompt).not.toContain("<context>")
    }),
  )

  it.effect("secure mode sends only the escaped brief", () =>
    Effect.gen(function* () {
      calls.length = 0
      reply = () => Effect.succeed({ text: "Solid advice.", ...zeroUsage })
      const { registry } = yield* setup(new ConfigExperimental.Info({ advisor: true }), secure)
      const definition = yield* find(registry)
      expect(definition?.inputSchema).toHaveProperty("required", ["question", "context"])
      yield* run(registry, { question: "Q <b>", context: "C & D" })
      expect(calls).toHaveLength(1)
      expect(calls[0]?.transcript).toBe(false)
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

  it.effect("switches mode through the RPC and persists it", () =>
    Effect.gen(function* () {
      const { registry, map } = yield* setup(new ConfigExperimental.Info({ advisor: true }), { mode: "off" })
      const next: Advisor.State = { mode: "secure", model: { providerID: "p", id: "m" } }
      const handler = captured
      if (!handler) return yield* Effect.die("rpc.set was not captured")
      const saved = yield* Effect.orDie(handler.set(next))
      expect(saved).toEqual(next)
      const definition = yield* find(registry)
      expect(definition?.inputSchema).toHaveProperty("required", ["question", "context"])
      expect(map.get("state")).toEqual(next)
    }),
  )

  it.effect("turning the advisor off through the RPC removes the tool", () =>
    Effect.gen(function* () {
      const { registry, map } = yield* setup(new ConfigExperimental.Info({ advisor: true }), full)
      expect(yield* names(registry)).toContain(AdvisorPlugin.name)
      const handler = captured
      if (!handler) return yield* Effect.die("rpc.set was not captured")
      yield* Effect.orDie(handler.set({ mode: "off" }))
      expect(yield* names(registry)).not.toContain(AdvisorPlugin.name)
      expect(map.get("state")).toEqual({ mode: "off" })
    }),
  )
  it.effect("tells the model about the advisor only while the tool is in the request", () =>
    Effect.gen(function* () {
      yield* setup(new ConfigExperimental.Info({ advisor: true }), secure)
      const system = yield* systemFor({ [AdvisorPlugin.name]: {} })
      expect(system).toHaveLength(1)
      expect(system[0]).toContain("# Advisor")
      expect(system[0]).toContain("(p/m)")
      expect(system[0]).toContain("never sees this conversation")
      expect(yield* systemFor({})).toEqual([])
      const handler = captured
      if (!handler) return yield* Effect.die("rpc.set was not captured")
      yield* Effect.orDie(handler.set({ mode: "off" }))
      expect(yield* systemFor({ [AdvisorPlugin.name]: {} })).toEqual([])
    }),
  )
})

function document(experimental: ConfigExperimental.Info | undefined): Entry {
  return new Document({ type: "document", info: new Info(experimental ? { experimental } : {}) })
}

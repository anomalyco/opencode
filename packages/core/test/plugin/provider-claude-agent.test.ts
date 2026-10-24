import { Message } from "@opencode/ai"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { AISDK } from "@opencode/core/aisdk"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import type { ClaudeIO } from "@opencode/core/claude-agent/claude/io"
import { ClaudeSessions } from "@opencode/core/claude-agent/claude/sessions"
import { RequestKind } from "@opencode/core/claude-agent/language-model/request-kind"
import { ClaudeSystemPrompt } from "@opencode/core/claude-agent/language-model/system-prompt"
import { ClaudeIntegration } from "@opencode/core/claude-agent/plugin/integration"
import { ClaudeProvider } from "@opencode/core/claude-agent/plugin/provider"
import { Credential } from "@opencode/core/credential"
import { Database } from "@opencode/core/database/database"
import { Environment, makeFiles } from "@opencode/core/environment/index"
import { EnvironmentUnavailable } from "@opencode/core/environment/unavailable"
import { Integration } from "@opencode/core/integration"
import { KV } from "@opencode/core/kv"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { ClaudeAgentPlugin, ID, make } from "@opencode/core/plugin/provider/claude-agent"
import { DynamicProviderPlugin } from "@opencode/core/plugin/provider/dynamic"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { SessionInbox } from "@opencode/core/session/inbox"
import { describe, expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { FakeClaude } from "../claude-agent/lib/fake-claude"
import { FakeIO } from "../claude-agent/lib/fake-io"
import { TestSessions } from "../claude-agent/lib/sessions"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make(ClaudeProvider.ID)
const haiku = Model.Ref.make({ providerID: ClaudeProvider.ID, id: Model.ID.make("haiku") })

// The registry outlives the plugin's scope in opencode, so each test closes its own, as an exiting opencode would.
const addPlugin = Effect.fn(function* (io: ClaudeIO.Interface) {
  const registry = ClaudeSessions.registry()
  yield* Effect.addFinalizer(() => registry.close())
  const host = yield* PluginHost.make(yield* Plugin.Service, ID)
  yield* make(io, registry).effect(host)
  return registry
})

const storage = Effect.gen(function* () {
  return PluginHost.storage(yield* KV.Service, ID)
})

const connect = Effect.gen(function* () {
  const credentials = yield* Credential.Service
  return yield* credentials.create({
    integrationID,
    value: Credential.External.make({ type: "external", methodID: Integration.MethodID.make(ClaudeIntegration.METHOD_ID) }),
  })
})

const claudeModels = Effect.gen(function* () {
  const result: Model.Info[] = []
  for (const model of yield* (yield* Model.Service).all()) {
    if (model.providerID === ClaudeProvider.ID) result.push(model)
  }
  return result
})

const connectionStatus = Effect.gen(function* () {
  const integration = yield* (yield* Integration.Service).get(integrationID)
  return integration?.connections[0]?.status
})

const eventually = <A, R>(effect: Effect.Effect<A, never, R>, predicate: (value: A) => boolean) =>
  effect.pipe(
    Effect.filterOrFail(predicate, () => new Error("Timed out waiting for value")),
    Effect.retry({ times: 3000, schedule: Schedule.spaced("1 millis") }),
  )

function find(models: readonly Model.Info[], id: string) {
  const model = models.find((model) => model.id === id)
  if (!model) throw new Error(`Expected model ${id}`)
  return model
}

describe("ClaudeAgentPlugin", () => {
  it.effect("runs before the dynamic provider plugin, which would load an npm package instead", () =>
    Effect.sync(() => {
      const ids = ProviderPlugins.map((plugin) => plugin.id)
      expect(ids.indexOf(ClaudeAgentPlugin.id)).toBeGreaterThanOrEqual(0)
      expect(ids.indexOf(ClaudeAgentPlugin.id)).toBeLessThan(ids.indexOf(DynamicProviderPlugin.id))
    }),
  )

  it.live("skips where opencode cannot start local processes", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([])
      yield* addPlugin(FakeIO.make({ claude })).pipe(
        Effect.provideService(
          Environment.Service,
          Environment.Service.of({
            files: makeFiles({ spawner: EnvironmentUnavailable.spawner }),
            spawner: EnvironmentUnavailable.spawner,
          }),
        ),
      )
      expect(yield* (yield* Provider.Service).get(ClaudeProvider.ID)).toBeUndefined()
      expect(yield* (yield* Integration.Service).get(integrationID)).toBeUndefined()
    }),
  )
})

describe("ClaudeAgentPlugin models", () => {
  it.live("starts without models or a claude run, and connecting fills and saves the list", () =>
    Effect.gen(function* () {
      const onConnect = FakeClaude.expectStartup()
      const claude = FakeClaude.make([onConnect])
      yield* addPlugin(FakeIO.make({ claude }))
      expect(yield* claudeModels).toEqual([])
      expect(claude.runs).toHaveLength(0)

      yield* connect
      yield* Effect.promise(() => claude.reached(onConnect))
      const models = yield* eventually(claudeModels, (models) => models.length > 0)
      expect(models.map((model) => model.id)).not.toContain("default")
      const sonnet = find(models, "sonnet")
      expect(sonnet.variants).toContainEqual({ id: Model.VariantID.make("high"), settings: { effort: "high" } })
      expect(sonnet.limit).toEqual({ context: 1_000_000, output: 0 })
      expect(find(models, "claude-opus-4-6").limit.context).toBe(200_000)
      expect(find(models, "haiku").family).toBe(Model.Family.make("claude-haiku"))
      for (const model of models) {
        expect(model.cost).toEqual([])
        expect(model.capabilities.input).toEqual(["text", "image", "pdf"])
      }
      const saved = yield* (yield* storage).get("models")
      expect(Array.isArray(saved) ? saved.length : 0).toBe(models.length)
      claude.check()
    }),
  )

  it.live("starts with the saved list without running claude", () =>
    Effect.gen(function* () {
      yield* (yield* storage).set("models", [
        { id: "opus", name: "Opus", efforts: ["high"], contextWindow: 1_000_000 },
      ])
      yield* connect
      const claude = FakeClaude.make([])
      yield* addPlugin(FakeIO.make({ claude }))
      const models = yield* claudeModels
      expect(models.map((model) => String(model.id))).toEqual(["opus"])
      expect(find(models, "opus").limit.context).toBe(1_000_000)
      expect(claude.runs).toHaveLength(0)
    }),
  )

  it.live("ignores a malformed saved list and checks claude when already connected", () =>
    Effect.gen(function* () {
      yield* (yield* storage).set("models", [{ id: 1 }])
      yield* connect
      const atStart = FakeClaude.expectStartup()
      const claude = FakeClaude.make([atStart])
      yield* addPlugin(FakeIO.make({ claude }))
      yield* Effect.promise(() => claude.reached(atStart))
      yield* eventually(claudeModels, (models) => models.some((model) => model.id === "sonnet"))
      claude.check()
    }),
  )

  it.live("binds chats to plugin storage, and a chat's startup report keeps saved context sizes", () =>
    Effect.gen(function* () {
      yield* (yield* storage).set("models", [{ id: "haiku", name: "Haiku", efforts: [], contextWindow: 123_456 }])
      yield* connect
      const claude = FakeClaude.make([FakeClaude.expectStartup(), FakeClaude.expectTurn(), FakeClaude.expectInterrupt()])
      const registry = yield* addPlugin(FakeIO.make({ claude }))

      const sdk = yield* (yield* AISDK.Service).runSDK({
        model: Model.Info.make({
          ...Model.Info.default(ClaudeProvider.ID, haiku.id),
          modelID: haiku.id,
          package: Provider.aisdk(ClaudeProvider.PACKAGE),
        }),
        package: ClaudeProvider.PACKAGE,
        options: {},
      })
      const model: LanguageModelV3 = sdk.sdk.languageModel("haiku")
      const result = yield* Effect.promise(() =>
        model.doStream({
          prompt: TestSessions.prompt("Remember the marker COPPER-OTTER. Reply only with that marker."),
          headers: { [RequestKind.SESSION_HEADER]: "session-a", [RequestKind.HEADER]: "primary" },
        }),
      )
      expect(TestSessions.text(yield* Effect.promise(() => TestSessions.collect(result.stream)))).toBe("COPPER-OTTER")
      expect(yield* (yield* storage).get("sessions/session-a")).toMatchObject({ claudeSessionID: expect.any(String) })

      const models = yield* eventually(claudeModels, (models) => models.length > 1)
      expect(find(models, "haiku").limit.context).toBe(123_456)
      yield* registry.close()
      claude.check()
    }),
  )
})

describe("ClaudeAgentPlugin connection", () => {
  it.live("connecting without claude installed asks the user to install it", () =>
    Effect.gen(function* () {
      const claude = FakeClaude.make([])
      yield* addPlugin({ ...FakeIO.make({ claude }), which: () => undefined })
      yield* connect
      const status = yield* eventually(connectionStatus, (status) => status !== undefined)
      expect(status).toMatchObject({ status: "needs_auth", url: "https://code.claude.com/docs/en/setup" })
      expect(yield* claudeModels).toEqual([])
      expect(claude.runs).toHaveLength(0)
    }),
  )

  it.live("an API-key login is not a sign-in problem", () =>
    Effect.gen(function* () {
      const onConnect = FakeClaude.expectStartup()
      const claude = FakeClaude.make([onConnect])
      yield* addPlugin(FakeIO.make({ claude, env: { ANTHROPIC_API_KEY: "fixture-secret" } }))
      yield* connect
      yield* Effect.promise(() => claude.reached(onConnect))
      yield* eventually(claudeModels, (models) => models.length > 0)
      expect(yield* connectionStatus).toBeUndefined()
      claude.check()
    }),
  )
})

describe("ClaudeAgentPlugin session hooks", () => {
  const hookEvent = Effect.fn(function* (sessionID: Session.ID, agent = "build") {
    return {
      sessionID,
      agent: Agent.ID.make(agent),
      model: haiku,
      system: [],
      messages: [] as Message[],
      options: { maxTokens: 32_000 } as Record<string, unknown>,
      tools: {},
    }
  })

  const newSession = Effect.gen(function* () {
    const location = yield* Location.Service
    return yield* (yield* Session.Service).create({ location: { directory: location.directory } })
  })

  const addAgents = Effect.gen(function* () {
    const agents = yield* Agent.Service
    yield* agents.transform((editor) => {
      editor.update(Agent.ID.make("reviewer"), (info) => {
        info.system = "You review code."
      })
      editor.update(Agent.ID.make("build"), () => {})
    })
  })

  it.live("tags requests by kind, and marks a fork's primary requests with its source", () =>
    Effect.gen(function* () {
      yield* addPlugin(FakeIO.make({ claude: FakeClaude.make([]) }))
      const sessions = yield* Session.Service
      const hooks = yield* PluginHooks.Service
      const source = yield* newSession
      yield* sessions.prompt({ sessionID: source.id, text: "Fork context", resume: false })
      yield* SessionInbox.promote((yield* Database.Service).db, yield* Bus.Service, source.id, "steer")
      const fork = yield* sessions.fork({ sessionID: source.id })

      const request = (sessionID: Session.ID, kind: "primary" | "title") =>
        hooks.trigger("session", "model.request", {
          sessionID,
          agent: Agent.ID.make("build"),
          model: haiku,
          kind,
          headers: {},
        })
      expect((yield* request(source.id, "primary")).headers).toEqual({ [RequestKind.HEADER]: "primary" })
      expect((yield* request(fork.id, "primary")).headers).toEqual({
        [RequestKind.HEADER]: "primary",
        [RequestKind.FORK_HEADER]: source.id,
      })
      expect((yield* request(fork.id, "title")).headers).toEqual({ [RequestKind.HEADER]: "title" })
    }),
  )

  it.live("leaves the output budget to Claude and keeps tool error flags", () =>
    Effect.gen(function* () {
      yield* addPlugin(FakeIO.make({ claude: FakeClaude.make([]) }))
      yield* addAgents
      const hooks = yield* PluginHooks.Service
      const session = yield* newSession
      const event = yield* hookEvent(session.id)
      event.messages = [
        Message.tool({ id: "call-1", name: "bash", result: { error: { type: "aborted" } }, resultType: "error" }),
        Message.tool({ id: "call-2", name: "bash", result: "exit 1", resultType: "error" }),
        Message.tool({ id: "call-3", name: "bash", result: "ok" }),
      ]
      const context = yield* hooks.trigger("session", "context", event)
      expect(context.options.maxTokens).toBeUndefined()
      const flags: unknown[] = []
      for (const message of context.messages) {
        const part = message.content[0]
        flags.push(part && "providerMetadata" in part ? part.providerMetadata?.[ClaudeProvider.ID] : undefined)
      }
      expect(flags).toEqual([
        { toolError: true, toolAborted: true },
        { toolError: true, toolAborted: false },
        undefined,
      ])

      // Compaction keeps OpenCode's summary budget.
      const compaction = yield* hooks.trigger("session", "compaction", yield* hookEvent(session.id))
      expect(compaction.options.maxTokens).toBe(32_000)
    }),
  )

  it.live("passes the agent's role to Claude on every kind of request", () =>
    Effect.gen(function* () {
      yield* addPlugin(FakeIO.make({ claude: FakeClaude.make([]) }))
      yield* addAgents
      const hooks = yield* PluginHooks.Service
      const session = yield* newSession
      for (const kind of ["context", "generate", "compaction"] as const) {
        const reviewer = yield* hooks.trigger("session", kind, yield* hookEvent(session.id, "reviewer"))
        expect(reviewer.options[ClaudeSystemPrompt.AGENT_OPTION]).toBe("You review code.")
        const build = yield* hooks.trigger("session", kind, yield* hookEvent(session.id, "build"))
        expect(build.options[ClaudeSystemPrompt.AGENT_OPTION]).toBe("")
      }
    }),
  )

  it.live("never retries a turn, since Claude Code already retries API failures", () =>
    Effect.gen(function* () {
      yield* addPlugin(FakeIO.make({ claude: FakeClaude.make([]) }))
      const hooks = yield* PluginHooks.Service
      const session = yield* newSession
      const event = yield* hooks.trigger("session", "retry", {
        sessionID: session.id,
        agent: Agent.ID.make("build"),
        model: haiku,
        error: { type: "provider", message: "Anthropic is overloaded (529)" },
        attempt: 1,
        decision: { retry: true, delay: 1000 },
      })
      expect(event.decision).toEqual({ retry: false })
    }),
  )
})

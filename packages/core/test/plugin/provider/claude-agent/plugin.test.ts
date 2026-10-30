import { Message, SystemPart } from "@opencode/ai/effect"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import type { AccountInfo } from "@anthropic-ai/claude-agent-sdk"
import { AISDK } from "@opencode/core/aisdk"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import type { ClaudeIO } from "@opencode/core/plugin/provider/claude-agent/claude/io"
import { ClaudeSessions } from "@opencode/core/plugin/provider/claude-agent/claude/sessions"
import { RequestKind } from "@opencode/core/plugin/provider/claude-agent/language-model/request-kind"
import { ClaudeSystemPrompt } from "@opencode/core/plugin/provider/claude-agent/language-model/system-prompt"
import { ClaudeIntegration } from "@opencode/core/plugin/provider/claude-agent/integration"
import { ClaudeProvider } from "@opencode/core/plugin/provider/claude-agent/provider"
import { Credential } from "@opencode/core/credential"
import { Database } from "@opencode/core/database/database"
import { Environment, makeFiles } from "@opencode/core/environment/index"
import { EnvironmentUnavailable } from "@opencode/core/environment/unavailable"
import { Integration } from "@opencode/core/integration"
import { KV } from "@opencode/core/kv"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { Money } from "@opencode/schema/money"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { ID, make } from "@opencode/core/plugin/provider/claude-agent/index"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { SessionInbox } from "@opencode/core/session/inbox"
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { FakeClaude } from "./lib/fake-claude"
import { FakeIO } from "./lib/fake-io"
import { TestSessions } from "./lib/sessions"
import { testEffect } from "../../../lib/effect"
import { PluginTestLayer } from "../../fixture"

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
    value: Credential.External.make({
      type: "external",
      methodID: Integration.MethodID.make(ClaudeIntegration.METHOD_ID),
    }),
  })
})

const claudeModels = Effect.gen(function* () {
  const result: Model.Info[] = []
  const models = yield* Model.Service
  for (const model of yield* models.all()) {
    if (model.providerID === ClaudeProvider.ID) result.push(model)
  }
  return result
})

const connectionStatus = Effect.gen(function* () {
  const integrations = yield* Integration.Service
  const integration = yield* integrations.get(integrationID)
  return integration?.connections[0]?.status
})

// Bounded by elapsed time rather than attempts, so a busy machine still fits.
function eventually<A, R>(
  effect: Effect.Effect<A, never, R>,
  predicate: (value: A) => boolean,
  deadline = Date.now() + 10_000,
): Effect.Effect<A, Error, R> {
  return Effect.gen(function* () {
    const value = yield* effect
    if (predicate(value)) return value
    if (Date.now() > deadline) return yield* Effect.fail(new Error("Timed out waiting for value"))
    yield* Effect.promise(() => Bun.sleep(1))
    return yield* eventually(effect, predicate, deadline)
  })
}

function find(models: readonly Model.Info[], id: string) {
  const model = models.find((model) => model.id === id)
  if (!model) throw new Error(`Expected model ${id}`)
  return model
}

const price = [
  {
    input: Money.USDPerMillionTokens.make(3),
    output: Money.USDPerMillionTokens.make(15),
    cache: { read: Money.USDPerMillionTokens.make(0.3), write: Money.USDPerMillionTokens.make(3.75) },
  },
]

const apiKey: AccountInfo = { apiKeySource: "ANTHROPIC_API_KEY", apiProvider: "firstParty" }

// Stands in for models.dev, which lists prices before the plugin runs
const listPrice = Effect.fn(function* (providerID: Provider.ID, modelID: string) {
  const providers = yield* Provider.Service
  yield* providers.transform((editor) => {
    editor.add({
      info: Provider.Info.empty(providerID),
      models: [{ ...Model.Info.default(providerID, Model.ID.make(modelID)), cost: price }],
    })
  })
})

const sonnetCost = Effect.fn(function* (account: AccountInfo, env?: Record<string, string>) {
  const onConnect = FakeClaude.expectStartup({ account })
  const claude = FakeClaude.make([onConnect])
  yield* addPlugin(FakeIO.make({ claude, env }))
  yield* connect
  yield* Effect.promise(() => claude.reached(onConnect))
  const models = yield* eventually(claudeModels, (models) => models.length > 0)
  claude.check()
  return find(models, "sonnet").cost
})

describe("ClaudeAgentPlugin", () => {
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
      const providers = yield* Provider.Service
      const integrations = yield* Integration.Service
      expect(yield* providers.get(ClaudeProvider.ID)).toBeUndefined()
      expect(yield* integrations.get(integrationID)).toBeUndefined()
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
      expect(find(models, "haiku").family).toBe(Model.Family.make("claude-haiku"))
      for (const model of models) {
        expect(model.cost).toEqual([])
        expect(model.capabilities.input).toEqual(["text", "image", "pdf"])
      }
      const store = yield* storage
      expect(yield* store.get("models")).toHaveProperty("models.length", models.length)
      claude.check()
    }),
  )

  it.live("starts with the saved list and its prices without running claude", () =>
    Effect.gen(function* () {
      const store = yield* storage
      const opus = "us.anthropic.claude-opus-4-6-v1[1m]"
      yield* store.set("models", {
        priceSource: "amazon-bedrock",
        models: [{ id: opus, name: "Opus", efforts: ["high"], contextWindow: 1_000_000, resolvedModel: opus }],
      })
      yield* listPrice(Provider.ID.amazonBedrock, "us.anthropic.claude-opus-4-6-v1")
      yield* connect
      const claude = FakeClaude.make([])
      yield* addPlugin(FakeIO.make({ claude }))
      const models = yield* claudeModels
      expect(models.map((model) => String(model.id))).toEqual([opus])
      expect(find(models, opus).limit.context).toBe(1_000_000)
      expect(find(models, opus).cost).toEqual(price)
      expect(claude.runs).toHaveLength(0)
    }),
  )

  it.live("shows no cost for a subscription", () =>
    Effect.gen(function* () {
      yield* listPrice(Provider.ID.anthropic, "claude-sonnet-5-5")
      expect(yield* sonnetCost({ subscriptionType: "Claude Team", apiProvider: "firstParty" })).toEqual([])
    }),
  )

  it.live("shows Anthropic's prices for an API key login", () =>
    Effect.gen(function* () {
      yield* listPrice(Provider.ID.anthropic, "claude-sonnet-5-5")
      expect(yield* sonnetCost(apiKey)).toEqual(price)
    }),
  )

  it.live("shows no cost through a custom base URL, which bills in its own way", () =>
    Effect.gen(function* () {
      yield* listPrice(Provider.ID.anthropic, "claude-sonnet-5-5")
      expect(yield* sonnetCost(apiKey, { ANTHROPIC_BASE_URL: "https://gateway.example" })).toEqual([])
    }),
  )

  it.live("shows a cloud account its cloud's prices", () =>
    Effect.gen(function* () {
      yield* listPrice(Provider.ID.googleVertex, "claude-sonnet-5-5@default")
      expect(yield* sonnetCost({ apiProvider: "vertex" })).toEqual(price)
    }),
  )

  it.live("ignores a malformed saved list and checks claude when already connected", () =>
    Effect.gen(function* () {
      const store = yield* storage
      yield* store.set("models", [{ id: 1 }])
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
      const store = yield* storage
      yield* store.set("models", { models: [{ id: "haiku", name: "Haiku", efforts: [], contextWindow: 123_456 }] })
      yield* connect
      const claude = FakeClaude.make([
        FakeClaude.expectStartup(),
        FakeClaude.expectTurn(),
        FakeClaude.expectInterrupt(),
      ])
      const registry = yield* addPlugin(FakeIO.make({ claude }))

      const aisdk = yield* AISDK.Service
      const sdk = yield* aisdk.runSDK({
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
      expect(yield* store.get("sessions/session-a")).toMatchObject({ claudeSessionID: expect.any(String) })

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

  it.live("connecting while logged out of claude asks the user to sign in", () =>
    Effect.gen(function* () {
      const onConnect = FakeClaude.expectStartup({ recording: "startup-logged-out" })
      const claude = FakeClaude.make([onConnect])
      yield* addPlugin(FakeIO.make({ claude }))
      yield* connect
      yield* Effect.promise(() => claude.reached(onConnect))
      const status = yield* eventually(connectionStatus, (status) => status !== undefined)
      expect(status).toMatchObject({ status: "needs_auth", message: expect.stringContaining("claude auth login") })
      claude.check()
    }),
  )

  it.live("connecting with an old claude still lists its models", () =>
    Effect.gen(function* () {
      const onConnect = FakeClaude.expectStartup()
      onConnect.reply.claude_code_version = "2.1.247"
      const claude = FakeClaude.make([onConnect])
      yield* addPlugin(FakeIO.make({ claude }))
      yield* connect
      yield* eventually(claudeModels, (models) => models.length > 0)
      expect(yield* connectionStatus).toBeUndefined()
      claude.check()
    }),
  )
})

describe("ClaudeAgentPlugin session hooks", () => {
  const hookEvent = (sessionID: Session.ID, agent = "build") => ({
    sessionID,
    agent: Agent.ID.make(agent),
    model: haiku,
    system: [] as SystemPart[],
    messages: [] as Message[],
    options: { maxTokens: 32_000 } as Record<string, unknown>,
    tools: {},
  })

  const newSession = Effect.gen(function* () {
    const location = yield* Location.Service
    const sessions = yield* Session.Service
    return yield* sessions.create({ location: { directory: location.directory } })
  })

  const addAgents = Effect.gen(function* () {
    const agents = yield* Agent.Service
    yield* agents.transform((editor) => {
      editor.update(Agent.ID.make("reviewer"), (info) => {
        info.system = "You review code."
      })
      // The test layer has no built-in agents, so add a build agent without a system prompt.
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
      const event = hookEvent(session.id)
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
      const compaction = yield* hooks.trigger("session", "compaction", hookEvent(session.id))
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
        const reviewer = yield* hooks.trigger("session", kind, hookEvent(session.id, "reviewer"))
        expect(reviewer.options[ClaudeSystemPrompt.AGENT_OPTION]).toBe("You review code.")
        const build = yield* hooks.trigger("session", kind, hookEvent(session.id, "build"))
        expect(build.options[ClaudeSystemPrompt.AGENT_OPTION]).toBe("")
      }
    }),
  )

  it.live("passes opencode's instructions to Claude, except the date and environment Claude Code writes itself", () =>
    Effect.gen(function* () {
      yield* addPlugin(FakeIO.make({ claude: FakeClaude.make([]) }))
      yield* addAgents
      const hooks = yield* PluginHooks.Service
      const event = hookEvent((yield* newSession).id)
      event.system = [
        SystemPart.make("OPENCODE-PROMPT"),
        {
          ...SystemPart.make("JOINED-INSTRUCTIONS"),
          metadata: {
            experimental: {
              instructions: [
                { key: "core/skill-guidance", text: "SKILLS" },
                { key: "core/date", text: "DATE" },
                { key: "core/environment", text: "ENVIRONMENT" },
                { key: "api/deploy-target", text: "ENTRY" },
              ],
            },
          },
        },
        SystemPart.make("PLUGIN-PART"),
      ]
      const context = yield* hooks.trigger("session", "context", event)
      expect(context.options[ClaudeSystemPrompt.INSTRUCTIONS_OPTION]).toBe("SKILLS\n\nENTRY\n\nPLUGIN-PART")
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

describe("ClaudeAgentPlugin provider config", () => {
  it.live("passes the configured connection to Claude Code, for the login check and for chats", () =>
    Effect.gen(function* () {
      // The login check is answered by `probes`, so the script is only the chat
      const claude = FakeClaude.make(
        [FakeClaude.expectStartup(), FakeClaude.expectTurn(), FakeClaude.expectInterrupt()],
        { probes: true },
      )
      const registry = yield* addPlugin(
        FakeIO.make({ claude, env: { ANTHROPIC_BASE_URL: "https://from-shell.example" } }),
      )
      const providers = yield* Provider.Service
      yield* providers.transform((editor) => {
        editor.update(ClaudeProvider.ID, (provider) => {
          provider.settings = {
            baseURL: "https://gateway.example",
            authToken: "config-token",
            headerTimeout: 60000,
            chunkTimeout: 600000,
          }
          provider.headers = { "X-Team": "core" }
          provider.body = { metadata: { user_id: "dan" } }
        })
        editor.models.update(ClaudeProvider.ID, haiku.id, (model) => {
          model.settings = { baseURL: "https://haiku-gateway.example" }
          model.headers = { "X-Model": "haiku" }
        })
      })
      yield* connect
      yield* eventually(claudeModels, (models) => models.some((model) => model.id === "sonnet"))

      const check = claude.runs[0]!.env
      expect(check.ANTHROPIC_BASE_URL).toBe("https://gateway.example")
      expect(check.ANTHROPIC_AUTH_TOKEN).toBe("config-token")
      expect(check.API_TIMEOUT_MS).toBe("60000")
      expect(check.CLAUDE_STREAM_IDLE_TIMEOUT_MS).toBe("600000")
      expect(check.ANTHROPIC_CUSTOM_HEADERS).toBe("X-Team: core")
      expect(check.CLAUDE_CODE_EXTRA_BODY).toBe(JSON.stringify({ metadata: { user_id: "dan" } }))

      const models = yield* Model.Service
      const aisdk = yield* AISDK.Service
      const model = yield* models.get(ClaudeProvider.ID, haiku.id)
      if (!model) throw new Error("Expected the haiku model")
      const language = yield* aisdk.language(model)
      const result = yield* Effect.promise(() =>
        language.doStream({
          prompt: TestSessions.prompt("Remember the marker COPPER-OTTER. Reply only with that marker."),
          headers: { [RequestKind.SESSION_HEADER]: "session-a", [RequestKind.HEADER]: "primary" },
        }),
      )
      expect(TestSessions.text(yield* Effect.promise(() => TestSessions.collect(result.stream)))).toBe("COPPER-OTTER")

      // Model settings override the provider's, and only configured headers are sent, not opencode's own
      const chat = claude.runs.find((run) => run.args.includes("--include-partial-messages"))!.env
      expect(chat.ANTHROPIC_BASE_URL).toBe("https://haiku-gateway.example")
      expect(chat.ANTHROPIC_AUTH_TOKEN).toBe("config-token")
      expect(chat.ANTHROPIC_CUSTOM_HEADERS).toBe("X-Team: core\nX-Model: haiku")
      expect(chat.CLAUDE_CODE_EXTRA_BODY).toBe(JSON.stringify({ metadata: { user_id: "dan" } }))
      yield* registry.close()
      claude.check()
    }),
  )

  it.live("leaves the user's environment alone when nothing is configured", () =>
    Effect.gen(function* () {
      const onConnect = FakeClaude.expectStartup()
      const claude = FakeClaude.make([onConnect])
      yield* addPlugin(FakeIO.make({ claude, env: { ANTHROPIC_BASE_URL: "https://from-shell.example" } }))
      yield* connect
      yield* Effect.promise(() => claude.reached(onConnect))
      const env = claude.runs[0]!.env
      expect(env.ANTHROPIC_BASE_URL).toBe("https://from-shell.example")
      expect(env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
      expect(env.CLAUDE_CODE_EXTRA_BODY).toBeUndefined()
      claude.check()
    }),
  )
})

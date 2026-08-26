import { Money } from "@opencode-ai/schema/money"
import { Agent } from "@opencode-ai/schema/agent"
import { Session } from "@opencode-ai/schema/session"
import { OpenAIResponses } from "@opencode-ai/ai/protocols/openai-responses"
import { LLM } from "@opencode-ai/ai"
import { describe, expect } from "bun:test"
import { ConfigProvider, DateTime, Effect } from "effect"
import { Headers } from "effect/unstable/http"
import { Catalog } from "@opencode-ai/core/catalog"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { Model } from "@opencode-ai/core/model"
import { ModelResolver } from "@opencode-ai/core/model-resolver"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { GithubCopilotPlugin } from "@opencode-ai/core/plugin/provider/github-copilot"
import { OpenAIPlugin } from "@opencode-ai/core/plugin/provider/openai"
import { Project } from "@opencode-ai/core/project"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionModelRequest } from "@opencode-ai/core/session/model-request"
import { SessionModelTransport } from "@opencode-ai/core/session/model-transport"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  const integrations = yield* Integration.Service
  yield* OpenAIPlugin.effect(host).pipe(Effect.provideService(Integration.Service, integrations))
})

const addGithubCopilotPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* GithubCopilotPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

const request = Effect.fn(function* (providerID: Provider.ID, baseURL: string) {
  const hooks = yield* PluginHooks.Service
  const event = yield* hooks.trigger("session", "model.request", {
    sessionID: Session.ID.make("ses_test"),
    agent: Agent.ID.make("build"),
    model: Model.Ref.make({ providerID, id: Model.ID.make("gpt-5.5") }),
    baseURL,
    headers: {},
  })
  return {
    baseURL: event.baseURL,
    headers: event.headers,
    hasHttpHooks:
      (yield* hooks.has("session", "http.request", providerID)) ||
      (yield* hooks.has("session", "http.response", providerID)),
  }
})

describe("OpenAIPlugin", () => {
  it.effect("registers browser and headless ChatGPT OAuth methods", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      expect((yield* (yield* Integration.Service).get(Integration.ID.make("openai")))?.methods).toEqual([
        {
          id: Integration.MethodID.make("chatgpt-browser"),
          type: "oauth",
          label: "ChatGPT Pro/Plus (browser)",
        },
        {
          id: Integration.MethodID.make("chatgpt-headless"),
          type: "oauth",
          label: "ChatGPT Pro/Plus (headless)",
        },
      ])
    }),
  )

  it.effect("keeps the full OpenAI catalog under an API key connection", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      yield* catalog.transform((catalog) => {
        const item = Provider.Info.make({
          ...Provider.Info.empty(Provider.ID.openai),
          package: Provider.aisdk("@ai-sdk/openai"),
        })
        catalog.provider.update(item.id, (draft) => {
          draft.package = item.package
        })
        catalog.model.update(item.id, Model.ID.make("gpt-5.5"), (model) => {
          model.limit = { context: 1_050_000, input: 922_000, output: 128_000 }
        })
        catalog.model.update(item.id, Model.ID.make("gpt-4.1"), () => {})
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.Key.make({ type: "key", key: "sk-test" }),
      })
      yield* addPlugin()

      const direct = yield* request(Provider.ID.openai, "https://api.openai.com/v1")

      const provider = required(yield* catalog.provider.get(Provider.ID.openai))
      const model = required(yield* catalog.model.get(Provider.ID.openai, Model.ID.make("gpt-5.5")))
      expect(model.package).toBe(Provider.aisdk("@ai-sdk/openai"))
      expect(model.enabled).toBe(true)
      expect(model.limit).toEqual({ context: 1_050_000, input: 922_000, output: 128_000 })
      expect(model.capabilities.responsesWebsockets).toBe(true)
      expect(direct.headers).not.toHaveProperty("originator")
      expect(direct.hasHttpHooks).toBe(false)
      expect(provider.headers).not.toHaveProperty("originator")
      expect(required(yield* catalog.model.get(Provider.ID.openai, Model.ID.make("gpt-4.1"))).enabled).toBe(true)
    }),
  )

  it.effect("atomically switches ChatGPT OAuth and API-key OpenAI transports", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const credentials = yield* Credential.Service
      yield* catalog.transform((catalog) => {
        const item = Provider.Info.make({
          ...Provider.Info.empty(Provider.ID.openai),
          package: Provider.aisdk("@ai-sdk/openai"),
        })
        catalog.provider.update(item.id, (draft) => {
          draft.package = item.package
        })
        catalog.model.update(item.id, Model.ID.make("gpt-5.5"), (model) => {
          model.settings = { baseURL: "https://proxy.example/v1" }
        })
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          metadata: { accountID: "acct_123" },
        }),
      })
      yield* addPlugin()

      const selected = required(yield* catalog.model.get(Provider.ID.openai, Model.ID.make("gpt-5.5")))
      const resolver = yield* ModelResolver.Service
      const codex = yield* resolver.resolveModel(selected)
      const codexHeaders = yield* codex.model.route.auth.apply({
        request: LLM.request({ model: codex.model, prompt: "Hello" }),
        method: "POST",
        url: "https://chatgpt.com/backend-api/codex/responses",
        body: "{}",
        headers: Headers.fromInput(codex.model.route.defaults.headers),
      })

      expect(codex.model.route.endpoint.baseURL).toBe("https://chatgpt.com/backend-api/codex")
      expect(codexHeaders.authorization).toBe("Bearer chatgpt-token")
      expect(codexHeaders.originator).toBe("opencode")
      expect(codexHeaders["chatgpt-account-id"]).toBe("acct_123")

      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.Key.make({ type: "key", key: "sk-test" }),
      })
      const preservedHeaders = yield* codex.model.route.auth.apply({
        request: LLM.request({ model: codex.model, prompt: "Hello" }),
        method: "POST",
        url: "https://chatgpt.com/backend-api/codex/responses",
        body: "{}",
        headers: Headers.fromInput(codex.model.route.defaults.headers),
      })
      const direct = yield* resolver.resolveModel(selected)
      const headers = yield* direct.model.route.auth.apply({
        request: LLM.request({ model: direct.model, prompt: "Hello" }),
        method: "POST",
        url: "https://proxy.example/v1/responses",
        body: "{}",
        headers: Headers.fromInput(direct.model.route.defaults.headers),
      })

      expect(codex.model.route.endpoint.baseURL).toBe("https://chatgpt.com/backend-api/codex")
      expect(preservedHeaders.authorization).toBe("Bearer chatgpt-token")
      expect(direct.model.route.endpoint.baseURL).toBe("https://proxy.example/v1")
      expect(headers.authorization).toBe("Bearer sk-test")
      expect(headers.originator).toBeUndefined()
      expect(headers["chatgpt-account-id"]).toBeUndefined()
    }).pipe(Effect.provide(ModelResolver.layer)),
  )

  it.effect("selects Azure WebSocket from capability and the Azure flag only", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID: Integration.ID.make("openai"),
        value: Credential.Key.make({ type: "key", key: "sk-test" }),
      })
      yield* addPlugin()
      yield* addGithubCopilotPlugin()
      const executor = { execute: () => Effect.die("unused WebSocket execution") }
      const transport = SessionModelTransport.Service.of({
        bind: () => executor,
        close: () => Effect.void,
        closeAll: Effect.void,
      })
      const sessionID = Session.ID.make("ses_websocket_hooks")
      const agentID = Agent.ID.make("build")
      const route = OpenAIResponses.route.with({
        id: "deployment-responses",
        provider: Provider.ID.azure,
      })
      const model = SessionRunnerModel.resolved(route.model({ id: "gpt-5.5" }), {
        capabilities: { tools: true, input: ["text"], output: ["text"], responsesWebsockets: true },
        cost: [],
        limit: { context: 200_000, output: 32_000 },
      })
      const program = Effect.gen(function* () {
        const requests = yield* SessionModelRequest.Service
        return yield* requests.prepare({
          scope: {
            session: Session.Info.make({
              id: sessionID,
              projectID: Project.ID.global,
              cost: Money.USD.zero,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
              location: Location.Ref.make({ directory: AbsolutePath.make("/project") }),
            }),
            agentID,
            model,
            tools: { definitions: [], execute: () => Effect.die("unused tool execution") },
          },
          transcript: { system: [], messages: [] },
          webSocket: "session",
        })
      }).pipe(
        Effect.provide(SessionModelRequest.layer),
        Effect.provideService(SessionModelTransport.Service, transport),
      )

      const prepared = yield* program.pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({ env: { OPENCODE_EXPERIMENTAL_AZURE_RESPONSES_WEBSOCKET: "true" } }),
          ),
        ),
      )
      const otherProvider = yield* program.pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({ env: { OPENCODE_EXPERIMENTAL_OPENAI_RESPONSES_WEBSOCKET: "true" } }),
          ),
        ),
      )

      expect(prepared.options.webSocket).toBe(executor)
      expect(prepared.options.http).toBeUndefined()
      expect(otherProvider.options.webSocket).toBeUndefined()
    }),
  )
})

import { AISDK } from "@opencode-ai/core/aisdk"
import { App } from "@opencode-ai/core/app"
import { Agent } from "@opencode-ai/schema/agent"
import { Session } from "@opencode-ai/core/session"
import { Location } from "@opencode-ai/core/location"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Catalog } from "@opencode-ai/core/catalog"
import { Model } from "@opencode-ai/core/model"
import { ModelResolver } from "@opencode-ai/core/model-resolver"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import {
  copilotBaseURL,
  copilotEntitlementError,
  copilotFetch,
  GithubCopilotPlugin,
} from "@opencode-ai/core/plugin/provider/github-copilot"
import { Provider } from "@opencode-ai/core/provider"
import { Integration } from "@opencode-ai/core/integration"
import type { SessionRequestKind } from "@opencode-ai/plugin/effect/session"
import { fakeSelectorSdk } from "../fixture/selector"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* GithubCopilotPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

const sessions = Effect.fn(function* () {
  const service = yield* Session.Service
  const location = yield* Location.Service
  const parent = yield* service.create({ location: { directory: location.directory } })
  const child = yield* service.create({ parentID: parent.id })
  return { parent: parent.id, child: child.id }
})

const modelRequest = Effect.fn(function* (sessionID: Session.ID, kind: SessionRequestKind, agent = "build") {
  const hooks = yield* PluginHooks.Service
  return yield* hooks.trigger("session", "model.request", {
    sessionID,
    agent: Agent.ID.make(agent),
    model: Model.Ref.make({ providerID: Provider.ID.githubCopilot, id: Model.ID.make("gpt-5.4") }),
    kind,
    headers: {},
  })
})

describe("GithubCopilotPlugin", () => {
  test("prefers the account-specific Copilot API endpoint", () => {
    expect(
      copilotBaseURL({
        enterpriseUrl: "company.ghe.com",
        apiEndpoint: "https://api.business.githubcopilot.com",
      }),
    ).toBe("https://api.business.githubcopilot.com")
  })

  test("rejects accounts without Copilot chat access", () => {
    expect(copilotEntitlementError({ chat_enabled: false, can_signup_for_limited: true })).toContain("Copilot Free")
    expect(copilotEntitlementError({ chat_enabled: false, can_signup_for_limited: false })).toContain(
      "subscription or a seat",
    )
    expect(copilotEntitlementError({ chat_enabled: false })).toContain("subscription or a seat")
  })

  test("only blocks on an explicit entitlement denial", () => {
    expect(copilotEntitlementError({ chat_enabled: true })).toBeUndefined()
    expect(copilotEntitlementError({ chat_enabled: true, can_signup_for_limited: true })).toBeUndefined()
    expect(copilotEntitlementError({})).toBeUndefined()
  })

  it.effect("registers GitHub Copilot device OAuth", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const integrations = yield* Integration.Service
      expect((yield* integrations.get(Integration.ID.make("github-copilot")))?.methods).toContainEqual({
        id: Integration.MethodID.make("device"),
        type: "oauth",
        label: "Login with GitHub Copilot",
        form: expect.any(Array),
      })
    }),
  )

  it.effect("removes the generic key method", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      yield* integrations.transform((editor) => {
        editor.method.update({
          integrationID: Integration.ID.make("github-copilot"),
          method: { type: "key" },
        })
        editor.method.update({
          integrationID: Integration.ID.make("github-copilot"),
          method: { type: "env", names: ["GITHUB_TOKEN"] },
        })
      })
      yield* addPlugin()
      expect((yield* integrations.get(Integration.ID.make("github-copilot")))?.methods).toEqual([
        { type: "env", names: ["GITHUB_TOKEN"] },
        {
          id: Integration.MethodID.make("device"),
          type: "oauth",
          label: "Login with GitHub Copilot",
          form: expect.any(Array),
        },
      ])
    }),
  )

  it.live("adds Copilot authentication and request metadata headers", () =>
    Effect.gen(function* () {
      const requests: Headers[] = []
      const send = copilotFetch(
        "token",
        async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          requests.push(new Headers(init?.headers))
          return Response.json({ ok: true })
        },
        App.make({ name: "test", version: "1.2.3", channel: "beta" }),
      )
      yield* Effect.promise(() =>
        send("https://api.githubcopilot.com/chat/completions", {
          method: "POST",
          headers: { "x-api-key": "old" },
          body: JSON.stringify({
            messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png" } }] }],
          }),
        }),
      )
      expect(requests[0]?.get("authorization")).toBe("Bearer token")
      expect(requests[0]?.has("x-api-key")).toBe(false)
      expect(requests[0]?.get("x-initiator")).toBe("user")
      expect(requests[0]?.get("copilot-vision-request")).toBe("true")
      expect(requests[0]?.get("x-github-api-version")).toBe("2026-08-01")
      expect(requests[0]?.get("user-agent")).toBe("opencode/beta/1.2.3/test")
    }),
  )

  it.effect("adds Copilot authentication to native Anthropic requests", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const hooks = yield* PluginHooks.Service
      const event = yield* hooks.trigger("session", "http.request", {
        sessionID: Session.ID.make("ses_test"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.githubCopilot, id: Model.ID.make("claude-sonnet-4.5") }),
        kind: "primary",
        request: new Request("https://api.githubcopilot.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": "token" },
          body: JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] }),
        }),
      })
      expect(event.request.headers.get("authorization")).toBe("Bearer token")
      expect(event.request.headers.has("x-api-key")).toBe(false)
      expect(event.request.headers.get("x-initiator")).toBe("user")
      expect(event.request.headers.get("anthropic-beta")).toBe("interleaved-thinking-2025-05-14")
      expect(event.request.headers.get("x-github-api-version")).toBe("2026-08-01")
    }),
  )

  it.effect("classifies main-loop steps as agent interactions", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* modelRequest((yield* sessions()).parent, "primary")
      expect(event.headers).toEqual({ "X-Interaction-Type": "conversation-agent" })
    }),
  )

  it.effect("classifies child-session steps as subagent interactions", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* modelRequest((yield* sessions()).child, "primary")
      expect(event.headers).toEqual({ "X-Interaction-Type": "conversation-subagent", "x-initiator": "agent" })
    }),
  )

  it.effect("classifies title generation as a background interaction", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* modelRequest((yield* sessions()).parent, "title")
      expect(event.headers).toEqual({ "X-Interaction-Type": "conversation-background", "x-initiator": "agent" })
    }),
  )

  it.effect("classifies compaction requests by kind rather than agent", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* modelRequest((yield* sessions()).child, "compaction", "build")
      expect(event.headers).toEqual({ "X-Interaction-Type": "conversation-compaction", "x-initiator": "agent" })
    }),
  )

  it.effect("does not classify by agent name", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* modelRequest((yield* sessions()).parent, "primary", "compaction")
      expect(event.headers).toEqual({ "X-Interaction-Type": "conversation-agent" })
    }),
  )

  it.effect("ignores other providers' model requests", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const hooks = yield* PluginHooks.Service
      const event = yield* hooks.trigger("session", "model.request", {
        sessionID: (yield* sessions()).parent,
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.make("openai"), id: Model.ID.make("gpt-5.4") }),
        kind: "primary",
        headers: {},
      })
      expect(event.headers).toEqual({})
    }),
  )

  it.live("keeps a declared agent initiator when the body looks user-initiated", () =>
    Effect.gen(function* () {
      const requests: Headers[] = []
      const send = copilotFetch(
        "token",
        async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
          requests.push(new Headers(init?.headers))
          return Response.json({ ok: true })
        },
        App.make({ name: "test", version: "1.2.3", channel: "beta" }),
      )
      yield* Effect.promise(() =>
        send("https://api.githubcopilot.com/chat/completions", {
          method: "POST",
          headers: { "x-initiator": "agent" },
          body: JSON.stringify({ messages: [{ role: "user", content: "summarize" }] }),
        }),
      )
      expect(requests[0]?.get("x-initiator")).toBe("agent")
    }),
  )

  it.effect("classifies session generation requests as agent interactions", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* modelRequest((yield* sessions()).parent, "generate")
      expect(event.headers).toEqual({ "X-Interaction-Type": "conversation-agent" })
    }),
  )

  it.effect("creates the bundled Copilot SDK for the GitHub Copilot package", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const ignored = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-5")),
          modelID: Model.ID.make("gpt-5"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/openai-compatible",
        options: { name: "github-copilot" },
      })
      const result = yield* aisdk.runSDK({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-5")),
          modelID: Model.ID.make("gpt-5"),
          package: "aisdk:test-provider",
        }),
        package: "@ai-sdk/github-copilot",
        options: { name: "github-copilot" },
      })
      expect(ignored.sdk).toBeUndefined()
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("rewrites models.dev fallback models to the GitHub Copilot package", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      const aisdk = yield* AISDK.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(Provider.ID.githubCopilot, () => {})
        catalog.model.update(Provider.ID.githubCopilot, Model.ID.make("gpt-5.6-sol"), (model) => {
          model.package = Provider.aisdk("@ai-sdk/openai-compatible")
        })
      })
      yield* addPlugin()
      const fallback = required(yield* catalog.model.get(Provider.ID.githubCopilot, Model.ID.make("gpt-5.6-sol")))
      expect(fallback.package).toBe(Provider.aisdk("@ai-sdk/github-copilot"))

      const resolved = yield* ModelResolver.fromCatalogModel(fallback, undefined, {
        loadPackage: () => Effect.die("Copilot must not load a native provider package"),
        loadAISDK: (model) => aisdk.model(model),
      })
      expect(resolved.route.id).toBe("ai-sdk:@ai-sdk/github-copilot")
      expect(resolved.route.providerMetadataKey).toBe("copilot")
    }),
  )

  it.effect("selects languageModel when responses and chat are absent", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("claude-sonnet-4")),
          modelID: Model.ID.make("claude-sonnet-4"),
          package: "aisdk:test-provider",
        }),
        sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
        options: {},
      })
      expect(calls).toEqual(["languageModel:claude-sonnet-4"])
    }),
  )

  it.effect("selects languageModel with the API model ID when responses and chat are absent", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("alias")),
          modelID: Model.ID.make("claude-sonnet-4"),
          package: "aisdk:test-provider",
        }),
        sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
        options: {},
      })
      expect(calls).toEqual(["languageModel:claude-sonnet-4"])
    }),
  )

  it.effect("uses responses for gpt-5 models except gpt-5-mini", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-5")),
          modelID: Model.ID.make("gpt-5"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-5.1-codex")),
          modelID: Model.ID.make("gpt-5.1-codex"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-4o")),
          modelID: Model.ID.make("gpt-4o"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-5-mini")),
          modelID: Model.ID.make("gpt-5-mini"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-5-mini-2025-08-07")),
          modelID: Model.ID.make("gpt-5-mini-2025-08-07"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual([
        "responses:gpt-5",
        "responses:gpt-5.1-codex",
        "chat:gpt-4o",
        "chat:gpt-5-mini",
        "chat:gpt-5-mini-2025-08-07",
      ])
    }),
  )

  it.effect("uses advertised Copilot endpoint metadata before model ID fallbacks", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("mai-code-1-flash-picker")),
          modelID: Model.ID.make("mai-code-1-flash-picker"),
          package: "aisdk:test-provider",
          settings: { endpoint: "responses" },
        }),
        sdk: fakeSelectorSdk(calls),
        options: { endpoint: "responses" },
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("gpt-5")),
          modelID: Model.ID.make("gpt-5"),
          package: "aisdk:test-provider",
          settings: { endpoint: "chat" },
        }),
        sdk: fakeSelectorSdk(calls),
        options: { endpoint: "chat" },
      })
      expect(calls).toEqual(["responses:mai-code-1-flash-picker", "chat:gpt-5"])
    }),
  )

  it.effect("uses the API model ID when selecting responses or chat", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("default")),
          modelID: Model.ID.make("gpt-5"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("small")),
          modelID: Model.ID.make("gpt-5-mini"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("github-copilot"), Model.ID.make("sonnet")),
          modelID: Model.ID.make("claude-sonnet-4"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual(["responses:gpt-5", "chat:gpt-5-mini", "chat:claude-sonnet-4"])
    }),
  )

  it.effect("disables gpt-5-chat-latest before Copilot language selection", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(Provider.ID.make("github-copilot"), () => {})
        catalog.model.update(Provider.ID.make("github-copilot"), Model.ID.make("gpt-5-chat-latest"), () => {})
      })
      yield* addPlugin()
      expect(
        required(yield* catalog.model.get(Provider.ID.make("github-copilot"), Model.ID.make("gpt-5-chat-latest")))
          .enabled,
      ).toBe(false)
    }),
  )

  it.effect("does not disable gpt-5-chat-latest for non-Copilot providers", () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.Service
      yield* catalog.transform((catalog) => {
        catalog.provider.update(Provider.ID.make("custom-copilot"), () => {})
        catalog.model.update(Provider.ID.make("custom-copilot"), Model.ID.make("gpt-5-chat-latest"), () => {})
      })
      yield* addPlugin()
      expect(
        required(yield* catalog.model.get(Provider.ID.make("custom-copilot"), Model.ID.make("gpt-5-chat-latest")))
          .enabled,
      ).toBe(true)
    }),
  )

  it.effect("ignores non-Copilot providers", () =>
    Effect.gen(function* () {
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()
      const result = yield* aisdk.runLanguage({
        model: Model.Info.make({
          ...Model.Info.default(Provider.ID.make("openai"), Model.ID.make("gpt-5")),
          modelID: Model.ID.make("gpt-5"),
          package: "aisdk:test-provider",
        }),
        sdk: fakeSelectorSdk(calls),
        options: {},
      })
      expect(calls).toEqual([])
      expect(result.language).toBeUndefined()
    }),
  )
})

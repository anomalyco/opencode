import { App } from "@opencode/core/app"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/core/session"
import { Location } from "@opencode/core/location"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { Model } from "@opencode/core/model"
import { ModelResolver } from "@opencode/core/model-resolver"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import {
  copilotBaseURL,
  copilotEntitlementError,
  GithubCopilotPlugin,
  utilityTitle,
} from "@opencode/core/plugin/provider/github-copilot"
import { Message, SystemPart } from "@opencode/ai/effect"
import { Provider } from "@opencode/core/provider"
import { Integration } from "@opencode/core/integration"
import { Credential } from "@opencode/core/credential"
import { advance, drain } from "../lib/clock"
import type { SessionRequestKind } from "@opencode/plugin/effect/session"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin, "test")
  yield* GithubCopilotPlugin.effect(host)
})

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

const httpRequest = Effect.fn(function* (request: Request) {
  const hooks = yield* PluginHooks.Service
  return yield* hooks.trigger("session", "http.request", {
    sessionID: Session.ID.make("ses_test"),
    agent: Agent.ID.make("build"),
    model: Model.Ref.make({ providerID: Provider.ID.githubCopilot, id: Model.ID.make("gpt-5.4") }),
    kind: "primary",
    request,
  })
})

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

  const copilotAPI = (requests: string[], endpoint = "https://api.business.githubcopilot.com/") =>
    HttpClient.make((request) =>
      Effect.sync(() => {
        requests.push(request.url)
        if (request.url.endsWith("/copilot_internal/user"))
          return HttpClientResponse.fromWeb(request, Response.json({ endpoints: { api: endpoint } }))
        return HttpClientResponse.fromWeb(
          request,
          Response.json({
            data: [
              {
                model_picker_enabled: true,
                id: "gpt-5",
                name: "GPT-5",
                version: "gpt-5",
                capabilities: {
                  family: "gpt-5",
                  limits: { max_output_tokens: 1, max_prompt_tokens: 1 },
                  supports: { tool_calls: true },
                },
              },
            ],
          }),
        )
      }),
    )

  const connect = Effect.fn(function* (metadata?: Record<string, string>) {
    const credentials = yield* Credential.Service
    const providers = yield* Provider.Service
    yield* providers.transform((draft) => {
      draft.update(Provider.ID.githubCopilot, () => {})
    })
    yield* credentials.create({
      integrationID: Integration.ID.make("github-copilot"),
      value: Credential.OAuth.make({
        type: "oauth",
        methodID: Integration.MethodID.make("device"),
        access: "token",
        refresh: "token",
        expires: 0,
        ...(metadata ? { metadata } : {}),
      }),
    })
  })

  it.effect("reloads providers only when a refreshed model list changes", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const requests: string[] = []
      yield* connect()
      const models = () => requests.filter((url) => url.endsWith("/models"))
      yield* addPlugin().pipe(Effect.provideService(HttpClient.HttpClient, copilotAPI(requests)))
      yield* advance(() => models().length === 1)
      yield* drain
      const folds = { count: 0 }
      yield* providers.transform(() => {
        folds.count++
      })
      const before = folds.count

      yield* TestClock.adjust("10 minutes")
      yield* advance(() => models().length === 2)
      yield* drain
      expect(folds.count).toBe(before)
    }),
  )

  it.effect("refreshes the account's API endpoint instead of keeping the one stored at login", () =>
    Effect.gen(function* () {
      const models = yield* Model.Service
      const requests: string[] = []
      yield* connect({ apiEndpoint: "https://api.individual.githubcopilot.com" })
      yield* addPlugin().pipe(Effect.provideService(HttpClient.HttpClient, copilotAPI(requests)))
      yield* advance(() => requests.some((url) => url.endsWith("/models")))
      yield* drain

      expect(requests).toEqual([
        "https://api.github.com/copilot_internal/user",
        "https://api.business.githubcopilot.com/models",
      ])
      expect(required(yield* models.get(Provider.ID.githubCopilot, Model.ID.make("gpt-5"))).settings).toMatchObject({
        baseURL: "https://api.business.githubcopilot.com",
      })
    }),
  )

  it.effect("keeps the stored endpoint when the account lookup fails", () =>
    Effect.gen(function* () {
      const requests: string[] = []
      yield* connect({ apiEndpoint: "https://api.individual.githubcopilot.com" })
      const failing = HttpClient.make((request) =>
        request.url.endsWith("/copilot_internal/user")
          ? Effect.sync(() => {
              requests.push(request.url)
              return HttpClientResponse.fromWeb(request, new Response("unavailable", { status: 404 }))
            })
          : copilotAPI(requests).execute(request),
      )
      yield* addPlugin().pipe(Effect.provideService(HttpClient.HttpClient, failing))
      yield* advance(() => requests.some((url) => url.endsWith("/models")))

      expect(requests.at(-1)).toBe("https://api.individual.githubcopilot.com/models")
    }),
  )

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

  it.effect("adds Copilot authentication and request metadata headers to OpenAI requests", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* httpRequest(
        new Request("https://api.githubcopilot.com/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", authorization: "Bearer token" },
          body: JSON.stringify({
            messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png" } }] }],
          }),
        }),
      )
      expect(event.request.headers.get("authorization")).toBe("Bearer token")
      expect(event.request.headers.get("x-initiator")).toBe("user")
      expect(event.request.headers.get("copilot-vision-request")).toBe("true")
      expect(event.request.headers.get("x-github-api-version")).toBe("2026-08-01")
      expect(event.request.headers.get("openai-intent")).toBe("conversation-edits")
      expect(event.request.headers.has("anthropic-beta")).toBe(false)
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
          headers: {
            "Content-Type": "application/json",
            "x-api-key": "token",
            "anthropic-beta": "interleaved-thinking-2025-05-14,thinking-binding-controls-2026-08-01",
          },
          body: JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] }),
        }),
      })
      expect(event.request.headers.get("authorization")).toBe("Bearer token")
      expect(event.request.headers.has("x-api-key")).toBe(false)
      expect(event.request.headers.get("x-initiator")).toBe("user")
      expect(event.request.headers.get("anthropic-beta")).toBe(
        "interleaved-thinking-2025-05-14,thinking-binding-controls-2026-08-01",
      )
      expect(event.request.headers.get("x-github-api-version")).toBe("2026-08-01")
    }),
  )

  it.effect("classifies main-loop steps as agent interactions", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* modelRequest((yield* sessions()).parent, "primary")
      expect(event.headers).toEqual({ "X-Interaction-Type": "conversation-agent", "X-Interaction-Id": event.sessionID })
    }),
  )

  it.effect("classifies child-session steps as subagent interactions", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const ids = yield* sessions()
      const event = yield* modelRequest(ids.child, "primary")
      expect(event.headers).toEqual({
        "X-Interaction-Type": "conversation-subagent",
        "X-Interaction-Id": ids.parent,
        "x-initiator": "agent",
      })
    }),
  )

  it.effect("classifies title generation as a background interaction", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* modelRequest((yield* sessions()).parent, "title")
      expect(event.headers).toEqual({
        "X-Interaction-Type": "conversation-background",
        "X-Interaction-Id": event.sessionID,
        "x-initiator": "agent",
      })
    }),
  )

  it.effect("classifies compaction requests by kind rather than agent", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const ids = yield* sessions()
      const event = yield* modelRequest(ids.child, "compaction", "build")
      expect(event.headers).toEqual({
        "X-Interaction-Type": "conversation-compaction",
        "X-Interaction-Id": ids.parent,
        "x-initiator": "agent",
      })
    }),
  )

  it.effect("does not classify by agent name", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* modelRequest((yield* sessions()).parent, "primary", "compaction")
      expect(event.headers).toEqual({ "X-Interaction-Type": "conversation-agent", "X-Interaction-Id": event.sessionID })
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

  const titleRequest = {
    sessionID: Session.ID.make("ses_title"),
    system: [SystemPart.make("You are a title generator.")],
    messages: [Message.user("how do I make my python script faster")],
    options: { maxTokens: 32 },
  }
  const utilityInput = (send: (init?: RequestInit) => Response | Promise<Response>) => ({
    baseURL: "https://api.individual.githubcopilot.com",
    token: "token",
    model: "gpt-4o-mini",
    app: App.make({ name: "test", version: "1.2.3", channel: "beta" }),
    fetch: async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => send(init),
  })

  it.live("names sessions with the utility model as a free background request", () =>
    Effect.gen(function* () {
      const seen: Array<{ url?: string; init?: RequestInit }> = []
      const title = yield* utilityTitle(
        {
          ...utilityInput(() => Response.json({ choices: [{ message: { content: "  Speed Up Python Script\n" } }] })),
          fetch: async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
            seen.push({ url: String(input), init })
            return Response.json({ choices: [{ message: { content: "  Speed Up Python Script\n" } }] })
          },
        },
        titleRequest,
      )
      expect(title).toBe("Speed Up Python Script")
      expect(seen[0]?.url).toBe("https://api.individual.githubcopilot.com/chat/completions")
      const headers = new Headers(seen[0]?.init?.headers)
      expect(headers.get("authorization")).toBe("Bearer token")
      expect(headers.get("x-interaction-type")).toBe("agent-session-name-generation")
      expect(headers.get("x-interaction-id")).toBe("ses_title")
      expect(headers.get("x-initiator")).toBe("agent")
      expect(headers.get("x-github-api-version")).toBe("2026-08-01")
      expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
        model: "gpt-4o-mini",
        stream: false,
        max_tokens: 32,
        messages: [
          { role: "system", content: "You are a title generator." },
          { role: "user", content: "how do I make my python script faster" },
        ],
      })
    }),
  )

  it.effect("sends the utility title request through the host's fetch", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const providers = yield* Provider.Service
      const hooks = yield* PluginHooks.Service
      const requests: string[] = []
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          requests.push(request.url)
          return HttpClientResponse.fromWeb(
            request,
            Response.json({
              data: [
                {
                  model_picker_enabled: true,
                  id: "gpt-4o-mini",
                  name: "GPT-4o mini",
                  version: "gpt-4o-mini",
                  capabilities: {
                    family: "gpt-4o-mini",
                    limits: { max_output_tokens: 1, max_prompt_tokens: 1 },
                    supports: { tool_calls: true },
                  },
                },
              ],
            }),
          )
        }),
      )
      const sent: string[] = []
      const outbound = Object.assign(
        async (input: Parameters<typeof fetch>[0]) => {
          sent.push(String(input))
          return Response.json({ choices: [{ message: { content: "Faster Python" } }] })
        },
        { preconnect: fetch.preconnect },
      )
      yield* providers.transform((draft) => {
        draft.update(Provider.ID.githubCopilot, () => {})
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("github-copilot"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("device"),
          access: "token",
          refresh: "token",
          expires: 0,
        }),
      })
      yield* addPlugin().pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.provideService(FetchHttpClient.Fetch, outbound),
      )
      yield* advance(() => requests.some((url) => url.endsWith("/models")))
      yield* drain

      const event = yield* hooks.trigger("session", "title", {
        ...titleRequest,
        model: Model.Ref.make({ providerID: Provider.ID.githubCopilot, id: Model.ID.make("gpt-5") }),
      })
      expect(event.result).toBe("Faster Python")
      expect(sent).toEqual(["https://api.githubcopilot.com/chat/completions"])
    }),
  )

  it.live("fails the utility title on rate limits so the billable path can run", () =>
    Effect.gen(function* () {
      const error = yield* utilityTitle(
        utilityInput(() => new Response("slow down", { status: 429 })),
        titleRequest,
      ).pipe(Effect.flip)
      expect(String(error)).toContain("429")
    }),
  )

  it.live("fails the utility title on an empty completion", () =>
    Effect.gen(function* () {
      const error = yield* utilityTitle(
        utilityInput(() => Response.json({ choices: [{ message: { content: null } }] })),
        titleRequest,
      ).pipe(Effect.flip)
      expect(String(error)).toContain("empty")
    }),
  )

  it.effect("flags images returned by tools in Responses requests", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* httpRequest(
        new Request("https://api.githubcopilot.com/responses", {
          method: "POST",
          headers: { authorization: "Bearer token" },
          body: JSON.stringify({
            input: [
              { role: "user", content: [{ type: "input_text", text: "Take a screenshot." }] },
              { type: "function_call", call_id: "call_1", name: "screenshot", arguments: "{}" },
              {
                type: "function_call_output",
                call_id: "call_1",
                output: [{ type: "input_image", image_url: "data:image/png;base64,AAAA" }],
              },
            ],
          }),
        }),
      )
      expect(event.request.headers.get("copilot-vision-request")).toBe("true")
      expect(event.request.headers.get("x-initiator")).toBe("agent")
    }),
  )

  it.effect("treats tool images moved into a Chat Completions user message as agent-initiated", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* httpRequest(
        new Request("https://api.githubcopilot.com/chat/completions", {
          method: "POST",
          headers: { authorization: "Bearer token" },
          body: JSON.stringify({
            messages: [
              { role: "user", content: "Take a screenshot." },
              {
                role: "assistant",
                content: null,
                tool_calls: [{ id: "call_1", type: "function", function: { name: "screenshot", arguments: "{}" } }],
              },
              { role: "tool", tool_call_id: "call_1", content: "" },
              { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
            ],
          }),
        }),
      )
      expect(event.request.headers.get("x-initiator")).toBe("agent")
      expect(event.request.headers.get("copilot-vision-request")).toBe("true")
    }),
  )

  it.effect("keeps a declared agent initiator when the body looks user-initiated", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* httpRequest(
        new Request("https://api.githubcopilot.com/responses", {
          method: "POST",
          headers: { authorization: "Bearer token", "x-initiator": "agent" },
          body: JSON.stringify({ input: [{ role: "user", content: [{ type: "input_text", text: "summarize" }] }] }),
        }),
      )
      expect(event.request.headers.get("x-initiator")).toBe("agent")
    }),
  )

  it.effect("classifies session generation requests as agent interactions", () =>
    Effect.gen(function* () {
      yield* addPlugin()
      const event = yield* modelRequest((yield* sessions()).parent, "generate")
      expect(event.headers).toEqual({ "X-Interaction-Type": "conversation-agent", "X-Interaction-Id": event.sessionID })
    }),
  )

  it.effect("routes models.dev fallback models to native Copilot APIs", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const fallback = {
        "claude-sonnet-4.5": "@opencode/ai/providers/anthropic",
        "gpt-4.1": "@opencode/ai/providers/openai",
        "gpt-5": "@opencode/ai/providers/openai-compatible",
        "gpt-5.1-codex": "@opencode/ai/providers/openai-compatible",
        "gpt-5-mini": "@opencode/ai/providers/openai-compatible",
        "gpt-4o": "@opencode/ai/providers/openai-compatible",
        "grok-4.5": "@opencode/ai/providers/openai-compatible",
        "mai-code-1.1-flash": "@opencode/ai/providers/openai-compatible",
        "gemini-3.8-flash": "@opencode/ai/providers/openai-compatible",
      }
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.githubCopilot, (provider) => {
          provider.activation = "enabled"
        })
        for (const [id, pkg] of Object.entries(fallback))
          editor.models.update(Provider.ID.githubCopilot, Model.ID.make(id), (model) => {
            model.package = pkg
          })
        editor.models.update(Provider.ID.githubCopilot, Model.ID.make("small"), (model) => {
          model.modelID = Model.ID.make("gpt-5-mini")
          model.package = "@opencode/ai/providers/openai-compatible"
        })
      })
      yield* addPlugin()
      const route = Effect.fn(function* (id: string) {
        const model = required(yield* models.get(Provider.ID.githubCopilot, Model.ID.make(id)))
        return { package: model.package, baseURL: model.settings?.baseURL }
      })
      const messages = { package: "@opencode/ai/providers/anthropic", baseURL: "https://api.githubcopilot.com/v1" }
      const responses = {
        package: "@opencode/ai/providers/openai-compatible-responses",
        baseURL: "https://api.githubcopilot.com",
      }
      const chat = { package: "@opencode/ai/providers/openai-compatible", baseURL: "https://api.githubcopilot.com" }
      expect(yield* route("claude-sonnet-4.5")).toEqual(messages)
      expect(yield* route("gpt-4.1")).toEqual(responses)
      expect(yield* route("gpt-5")).toEqual(responses)
      expect(yield* route("gpt-5.1-codex")).toEqual(responses)
      expect(yield* route("grok-4.5")).toEqual(responses)
      expect(yield* route("mai-code-1.1-flash")).toEqual(responses)
      expect(yield* route("gpt-5-mini")).toEqual(chat)
      expect(yield* route("small")).toEqual(chat)
      expect(yield* route("gpt-4o")).toEqual(chat)
      expect(yield* route("gemini-3.8-flash")).toEqual(chat)

      const resolved = yield* ModelResolver.fromCatalogModel(
        required(yield* models.get(Provider.ID.githubCopilot, Model.ID.make("gemini-3.8-flash"))),
      )
      expect(resolved.route.id).toBe("openai-compatible-chat")
    }),
  )

  it.effect("disables gpt-5-chat-latest before Copilot language selection", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.githubCopilot, (provider) => {
          provider.activation = "enabled"
        })
        editor.models.update(Provider.ID.githubCopilot, Model.ID.make("gpt-5-chat-latest"), () => {})
      })
      yield* addPlugin()
      expect(required(yield* models.get(Provider.ID.githubCopilot, Model.ID.make("gpt-5-chat-latest"))).enabled).toBe(
        false,
      )
    }),
  )

  it.effect("does not disable gpt-5-chat-latest for non-Copilot providers", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.make("custom-copilot"), () => {})
        editor.models.update(Provider.ID.make("custom-copilot"), Model.ID.make("gpt-5-chat-latest"), () => {})
      })
      yield* addPlugin()
      expect(
        required(yield* models.get(Provider.ID.make("custom-copilot"), Model.ID.make("gpt-5-chat-latest"))).enabled,
      ).toBe(true)
    }),
  )
})

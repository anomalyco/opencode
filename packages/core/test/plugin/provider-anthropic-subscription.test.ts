import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/core/session"
import { Message } from "@opencode/ai/effect"
import { Money } from "@opencode/schema/money"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import {
  AnthropicPlugin,
  checkSubscriptionUsage,
  prepareSubscriptionRequest,
  requestClaudeToken,
} from "@opencode/core/plugin/provider/anthropic"
import { Provider } from "@opencode/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

describe("Anthropic subscription", () => {
  it.effect("registers login and applies subscription headers only to the selected OAuth credential", () =>
    Effect.gen(function* () {
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin, AnthropicPlugin.id)
      yield* AnthropicPlugin.effect(host)
      const integration = yield* Integration.Service
      expect((yield* integration.get(Integration.ID.make("anthropic")))?.methods).toContainEqual({
        id: Integration.MethodID.make("claude-subscription"),
        type: "oauth",
        label: "Claude subscription (Pro/Max/Team)",
      })
      const attempt = yield* integration.oauth.connect({
        integrationID: Integration.ID.make("anthropic"),
        methodID: Integration.MethodID.make("claude-subscription"),
      })
      expect(attempt.mode).toBe("code")
      const authorize = new URL(attempt.url)
      expect(authorize.origin).toBe("https://claude.ai")
      expect(authorize.searchParams.get("code_challenge_method")).toBe("S256")
      yield* integration.oauth.cancel({ integrationID: Integration.ID.make("anthropic"), attemptID: attempt.attemptID })
      const hooks = yield* PluginHooks.Service
      const credentials = yield* Credential.Service
      const apiKey = yield* credentials.create({
        integrationID: Integration.ID.make("anthropic"),
        value: Credential.Key.make({ type: "key", key: "test-api-key" }),
      })
      const event = () => ({
        sessionID: Session.ID.make("ses_test"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.anthropic, id: Model.ID.make("claude-sonnet") }),
        kind: "primary" as const,
        headers: {} as Record<string, string>,
      })
      const requestEvent = () => ({
        sessionID: Session.ID.make("ses_test"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.anthropic, id: Model.ID.make("claude-sonnet") }),
        kind: "primary" as const,
      })
      const before = yield* hooks.trigger("session", "model.request", event())
      expect(before.headers["anthropic-beta"]).toBeUndefined()
      const call = () => ({
        ...requestEvent(),
        request: new Request("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet",
            system: [
              { type: "text", text: "project instructions" },
              {
                type: "text",
                text: "<env>\nWorkspace root folder: /project\nIs directory a git repo: yes\n</env>",
                cache_control: { type: "ephemeral" },
              },
            ],
          }),
        }),
      })
      const ordinary = yield* hooks.trigger("session", "http.request", call())
      expect(yield* Effect.promise(() => ordinary.request.json())).toMatchObject({
        system: [
          { type: "text", text: "project instructions" },
          { type: "text", text: "<env>\nWorkspace root folder: /project\nIs directory a git repo: yes\n</env>" },
        ],
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("anthropic"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("claude-subscription"),
          access: "test-access",
          refresh: "test-refresh",
          expires: Date.now() + 60_000,
        }),
      })
      const after = yield* hooks.trigger("session", "model.request", event())
      expect(after.headers["anthropic-beta"]).toContain("oauth-2025-04-20")
      const subscribed = yield* Effect.promise(() => prepareSubscriptionRequest(call().request))
      expect(yield* Effect.promise(() => subscribed.clone().json())).toMatchObject({
        system: [
          { type: "text", text: expect.stringContaining("x-anthropic-billing-header:") },
          { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
          { type: "text", text: "project instructions" },
          {
            type: "text",
            text: "<env>\nProject root: /project\nIs directory a git repo: yes\n</env>",
            cache_control: { type: "ephemeral" },
          },
        ],
      })
      expect(new URL(subscribed.url).searchParams.get("beta")).toBe("true")
      const context = yield* hooks.trigger("session", "context", {
        sessionID: Session.ID.make("ses_test"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.anthropic, id: Model.ID.make("claude-sonnet") }),
        system: [],
        messages: [
          Message.assistant([{ type: "tool-call", id: "call_1", name: "mcp_example_lookup", input: {} }]),
          Message.tool({ id: "call_1", name: "mcp_example_lookup", result: "ok" }),
        ],
        tools: { mcp_example_lookup: { description: "Lookup", input: { type: "object" } } },
        options: {},
      })
      expect(Object.keys(context.tools)).toEqual(["mcp__example_lookup"])
      expect(context.messages.map((message) => message.content[0])).toMatchObject([
        { type: "tool-call", name: "mcp__example_lookup" },
        { type: "tool-result", name: "mcp__example_lookup" },
      ])
      yield* credentials.activate(apiKey.id)
      expect((yield* hooks.trigger("session", "model.request", event())).headers["anthropic-beta"]).toBeUndefined()
      const restored = yield* hooks.trigger("session", "http.request", call())
      expect(yield* Effect.promise(() => restored.request.json())).toMatchObject({
        system: [
          { type: "text", text: "project instructions" },
          { type: "text", text: "<env>\nWorkspace root folder: /project\nIs directory a git repo: yes\n</env>" },
        ],
      })
    }),
  )

  it.effect("allows subscription usage only when extra usage is disabled", () =>
    Effect.gen(function* () {
      const server = Bun.serve({
        port: 0,
        fetch(request) {
          if (request.headers.get("user-agent") !== "claude-cli/2.1.289 (external, cli)")
            return new Response(null, { status: 429 })
          const path = new URL(request.url).pathname
          if (path === "/unavailable") return new Response(null, { status: 503 })
          if (path === "/missing") return Response.json({})
          return Response.json({ organization: { has_extra_usage_enabled: path === "/enabled" } })
        },
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
      const endpoint = `http://127.0.0.1:${server.port}`
      yield* checkSubscriptionUsage("test", `${endpoint}/disabled`)
      for (const path of ["enabled", "missing", "unavailable"]) {
        expect(yield* checkSubscriptionUsage("test", `${endpoint}/${path}`).pipe(Effect.flip)).toBeInstanceOf(Error)
      }
    }),
  )

  it.effect("exchanges and refreshes OAuth credentials", () =>
    Effect.gen(function* () {
      const server = Bun.serve({
        port: 0,
        async fetch(request) {
          if (request.headers.get("user-agent") !== "claude-cli/2.1.289 (external, cli)")
            return new Response(null, { status: 429 })
          const form = new URLSearchParams(await request.text())
          if (form.get("grant_type") === "authorization_code")
            return Response.json({ access_token: "initial", refresh_token: "refresh", expires_in: 3600 })
          if (form.get("refresh_token") === "refresh")
            return Response.json({ access_token: "updated", expires_in: 1800 })
          return new Response(null, { status: 401 })
        },
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
      const url = `http://127.0.0.1:${server.port}`
      const first = yield* requestClaudeToken({ grant_type: "authorization_code", code: "test-code" }, url)
      expect(first.access).toBe("initial")
      expect(first.refresh).toBe("refresh")
      const next = yield* requestClaudeToken({ grant_type: "refresh_token", refresh_token: first.refresh }, url)
      expect(next.access).toBe("updated")
      expect(next.refresh).toBe("refresh")
      expect(
        yield* requestClaudeToken({ grant_type: "refresh_token", refresh_token: "wrong" }, url).pipe(Effect.flip),
      ).toBeInstanceOf(Error)
    }),
  )

  it.effect("does not report per-token API costs for a subscription", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      const credentials = yield* Credential.Service
      yield* providers.transform((editor) => {
        editor.update(Provider.ID.anthropic, (provider) => {
          provider.package = "@opencode/ai/providers/anthropic"
        })
        editor.models.update(Provider.ID.anthropic, Model.ID.make("claude-test"), (model) => {
          model.cost = [
            {
              input: Money.USDPerMillionTokens.make(1),
              output: Money.USDPerMillionTokens.make(2),
              cache: { read: Money.USDPerMillionTokens.zero, write: Money.USDPerMillionTokens.zero },
            },
          ]
        })
      })
      yield* credentials.create({
        integrationID: Integration.ID.make("anthropic"),
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("claude-subscription"),
          access: "test-access",
          refresh: "test-refresh",
          expires: Date.now() + 60_000_000,
        }),
      })
      const plugin = yield* Plugin.Service
      yield* AnthropicPlugin.effect(yield* PluginHost.make(plugin, AnthropicPlugin.id))
      expect((yield* models.get(Provider.ID.anthropic, Model.ID.make("claude-test")))?.cost).toEqual([])
    }),
  )
})

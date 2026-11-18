import { expect } from "bun:test"
import { isRetryable } from "@opencode/ai"
import { RequestExecutor } from "@opencode/ai/route"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { Credential } from "@opencode/core/credential"
import { Plugin } from "@opencode/core/plugin"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { GoogleAntigravityPlugin, GoogleAntigravityOAuth, GoogleAntigravityWire } from "@shuvcode/antigravity-plugin"
import { Effect } from "effect"
import { testEffect } from "./lib/effect"
import { PluginTestLayer } from "./plugin/fixture"

const it = testEffect(PluginTestLayer)
const identity = {
  sessionID: Session.ID.make("ses_antigravity_error"),
  agent: Agent.ID.make("build"),
  model: Model.Ref.make({ providerID: Provider.ID.google, id: Model.ID.make("gemini-3.8-flash-high") }),
  kind: "primary" as const,
}

for (const modelID of ["gemini-4-argon-high", "gemini-3.8-flash-high"] as const) {
  for (const scenario of [
    { reason: "QUOTA_EXHAUSTED", message: "Capacity exhausted", tag: "QuotaExceeded", retryable: false },
    {
      reason: "RATE_LIMIT_EXCEEDED",
      message: "Your quota will reset after 5h.",
      tag: "QuotaExceeded",
      retryable: false,
    },
    {
      reason: "RATE_LIMIT_EXCEEDED",
      message: "Resource has been exhausted (e.g. check quota).",
      tag: "RateLimit",
      retryable: true,
    },
  ] as const) {
    it.effect(
      `Session (${modelID}) receives the full Antigravity ${scenario.reason} body as ${scenario.tag}: ${scenario.message}`,
      () =>
        Effect.gen(function* () {
          const modelIdentity = {
            ...identity,
            model: Model.Ref.make({ providerID: Provider.ID.google, id: Model.ID.make(modelID) }),
          }
          const plugin = yield* Plugin.Service
          const host = yield* PluginHost.make(plugin, "test")
          let responsePhase = false
          yield* GoogleAntigravityPlugin.effect({
            ...host,
            integration: {
              ...host.integration,
              connection: {
                active: () => Effect.succeed({ type: "credential", id: "fixture", label: "fixture", method: "oauth" }),
                // Resolution is unavailable after sending: the response hook must still explain
                // the body without making a quota-summary request or touching real credentials.
                resolve: () =>
                  Effect.succeed(
                    responsePhase
                      ? undefined
                      : Credential.OAuth.make({
                          type: "oauth",
                          methodID: GoogleAntigravityOAuth.methodID,
                          access: "fixture-access",
                          refresh: "",
                          expires: Date.now() + 3_600_000,
                          metadata: { projectId: "fixture-project", shuvcodeAuthImport: "access-only" },
                        }),
                  ),
                status: () => Effect.void,
              },
            },
          })
          const hooks = yield* PluginHooks.Service
          const event = yield* hooks.trigger("session", "http.request", {
            ...modelIdentity,
            request: new Request(
              `https://generativelanguage.googleapis.com/v1beta/models/${modelID}:streamGenerateContent`,
              {
                method: "POST",
                body: '{"contents":[]}',
              },
            ),
          })
          expect(event.request.url).toBe(GoogleAntigravityWire.generateURL)
          responsePhase = true
          const message = `${"padding ".repeat(100)}${scenario.message}`
          const body = JSON.stringify({
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              message,
              details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: scenario.reason }],
            },
          })
          expect(body.slice(0, 500)).not.toContain(scenario.message)
          const response = (yield* hooks.trigger("session", "http.response", {
            ...modelIdentity,
            request: event.request,
            response: new Response(body, {
              status: 429,
              headers: {
                "content-type": "text/event-stream",
                "content-length": String(body.length),
              },
            }),
          })).response
          const responseBody = yield* Effect.promise(() => response.text())
          expect(JSON.parse(responseBody).error.message).toBe(`RESOURCE_EXHAUSTED: ${message}`)
          const error = RequestExecutor.httpFailure({
            message: responseBody,
            url: event.request.url,
            status: response.status,
            responseHeaders: Object.fromEntries(response.headers),
            responseBody,
          })
          expect(error.reason._tag).toBe(scenario.tag)
          expect(isRetryable(error)).toBe(scenario.retryable)
          expect(error.message).toContain(message)
          expect(error.reason.http?.status).toBe(429)
          expect(error.reason.http?.headers["content-type"]).toBe("application/json")
          expect(error.reason.http?.headers["content-length"]).toBeUndefined()
        }),
    )
  }
}

it.effect("a bare RESOURCE_EXHAUSTED with nearly full quota classifies as a non-retryable content rejection", () =>
  Effect.sync(() => {
    const explained = GoogleAntigravityWire.explainCloudCodeError({
      error: { status: "RESOURCE_EXHAUSTED", message: "Resource has been exhausted (e.g. check quota)." },
      summary: { groups: [{ displayName: "Gemini models", buckets: [{ window: "5h", remainingFraction: 0.9998 }] }] },
      httpStatus: 429,
      modelID: "gemini-4-carbon-high",
    })
    const error = RequestExecutor.httpFailure({
      message: explained!.body,
      url: GoogleAntigravityWire.generateURL,
      status: 429,
      responseHeaders: { "content-type": "application/json" },
      responseBody: explained!.body,
    })
    expect(error.reason._tag).toBe("ContentPolicy")
    expect(isRetryable(error)).toBe(false)
    expect(error.message).toContain("likely not quota")
  }),
)

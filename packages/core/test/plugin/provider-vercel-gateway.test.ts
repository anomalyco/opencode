import { describe, expect } from "bun:test"
import { Clock, Effect, Schedule } from "effect"
import { TestClock } from "effect/testing"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { drain } from "../lib/clock"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { make } from "@opencode/core/plugin/provider/vercel-gateway"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import { withEnv } from "../fixture/env"
import type { Form } from "@opencode/schema/form"

const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make("vercel")
const methodID = Integration.MethodID.make("gateway-setup")

const replace = Effect.fn(function* (integrations: Integration.Interface, id: Credential.ID, key: string) {
  const methodID = Integration.MethodID.make("test-renew")
  yield* integrations.transform((editor) =>
    editor.method.update({
      integrationID,
      method: { id: methodID, type: "oauth", label: "Renew" },
      authorize: () =>
        Effect.succeed({
          mode: "auto" as const,
          url: "https://example.com",
          instructions: "Sign in",
          replaceCredentialID: id,
          callback: Effect.succeed(Credential.Key.make({ type: "key", key })),
        }),
    }),
  )
  yield* integrations.oauth.connect({ integrationID, methodID })
  yield* drain
})

const fixture = Effect.fn(function* (denied = false, clientID = "opencode-test-client", renew = false) {
  const credentials = yield* Credential.Service
  const previous = renew
    ? yield* credentials.create({
        integrationID,
        label: "Laptop",
        value: Credential.Key.make({
          type: "key",
          key: "expired-key",
          metadata: { teamID: "team_work", name: "Laptop key", expiration: "30", expiresAt: 1 },
        }),
      })
    : undefined
  if (previous)
    yield* credentials.create({
      integrationID,
      label: "Other",
      value: Credential.Key.make({ type: "key", key: "other-key" }),
    })
  const requests: Array<{ path: string; method: string; body?: unknown }> = []
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          const body = request.method === "POST" ? await request.text() : undefined
          requests.push({ path: url.pathname + url.search, method: request.method, body })
          if (url.pathname === "/.well-known/openid-configuration")
            return Response.json({
              device_authorization_endpoint: `${url.origin}/device`,
              token_endpoint: `${url.origin}/token`,
            })
          if (url.pathname === "/device")
            return Response.json({
              device_code: "device-code",
              user_code: "TEST-CODE",
              verification_uri: `${url.origin}/verify`,
              verification_uri_complete: `${url.origin}/verify?code=TEST-CODE`,
              expires_in: 300,
              interval: 1,
            })
          if (url.pathname === "/token")
            return denied
              ? Response.json({ error: "access_denied" }, { status: 400 })
              : Response.json({ access_token: "vercel-access-token" })
          expect(request.headers.get("Authorization")).toBe("Bearer vercel-access-token")
          if (url.pathname === "/v2/teams")
            return Response.json({
              teams: [{ id: "team_work", slug: "work", name: "Work" }],
              pagination: { next: null },
            })
          if (url.pathname === "/v1/api-keys")
            return Response.json({ apiKeyString: "gateway-key", apiKey: { id: "key_1" } })
          return new Response("Not found", { status: 404 })
        },
      }),
    ),
    (server) =>
      Effect.sync(() => {
        server.stop(true)
      }),
  )
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* make({ ...(clientID ? { clientID } : {}), issuer: server.url.origin, api: server.url.origin }).effect(host)
  const integrations = yield* Integration.Service
  const attempt = yield* integrations.oauth.connect({
    integrationID,
    methodID,
    ...(previous ? { answer: { credentialID: previous.id } } : {}),
  })
  const input = { integrationID, attemptID: attempt.attemptID }
  const status = (ready: (value: Integration.AttemptStatus) => boolean) =>
    integrations.oauth
      .status(input)
      .pipe(
        Effect.repeat({ while: (value) => !ready(value), schedule: Schedule.spaced("1 millis") }),
        Effect.timeout("5 seconds"),
      )
  return { requests, integrations, attempt, input, status, previous }
})

describe("Vercel AI Gateway setup", () => {
  it.live("keeps the old key and account selection when renewal is cancelled", () =>
    Effect.gen(function* () {
      const test = yield* fixture(false, "opencode-test-client", true)
      const credentials = yield* Credential.Service
      yield* test.status((value) => value.status === "pending" && !!value.prompt)
      yield* test.integrations.oauth.cancel(test.input)
      expect(yield* credentials.get(test.previous!.id)).toEqual(test.previous)
      expect((yield* test.integrations.get(integrationID))?.connections[0]).toMatchObject({ label: "Other" })
      expect(test.requests.some((request) => request.path.startsWith("/v1/api-keys"))).toBe(false)
    }),
  )
  it.effect("marks a saved key expired when its deadline passes and clears the warning on replacement", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const integrations = yield* Integration.Service
      const now = yield* Clock.currentTimeMillis
      const saved = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "old-key", metadata: { expiresAt: now + 60_000 } }),
      })
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      yield* make().effect(host)
      yield* drain
      expect((yield* integrations.get(integrationID))?.connections[0]?.status).toBeUndefined()
      yield* TestClock.adjust("1 minute")
      yield* drain
      expect((yield* integrations.get(integrationID))?.connections[0]?.status).toMatchObject({
        status: "needs_auth",
        message: expect.stringContaining("expired"),
      })
      yield* replace(integrations, saved.id, "new-key")
      expect((yield* integrations.get(integrationID))?.connections[0]?.status).toBeUndefined()
    }),
  )

  it.effect("treats Gateway 401s as reconnectable without confusing billing or a stale request with key expiry", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const integrations = yield* Integration.Service
      const hooks = yield* PluginHooks.Service
      const saved = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "old-key" }),
      })
      const plugin = yield* Plugin.Service
      const host = yield* PluginHost.make(plugin)
      yield* make().effect(host)
      const response = (status: number) =>
        hooks.trigger("session", "http.response", {
          sessionID: Session.ID.make("ses_gateway"),
          agent: Agent.ID.make("build"),
          model: Model.Ref.make({ providerID: Provider.ID.make("vercel"), id: Model.ID.make("test-model") }),
          kind: "primary",
          request: new Request("https://ai-gateway.vercel.sh/v1/chat/completions", {
            headers: { Authorization: "Bearer old-key" },
          }),
          response: Response.json({ error: "failed" }, { status }),
        })
      yield* response(402)
      yield* drain
      expect((yield* integrations.get(integrationID))?.connections[0]?.status).toBeUndefined()
      yield* response(401)
      yield* drain
      expect((yield* integrations.get(integrationID))?.connections[0]?.status?.message).toContain("Reconnect Vercel")
      yield* replace(integrations, saved.id, "replacement-key")
      yield* response(401)
      yield* drain
      expect((yield* integrations.get(integrationID))?.connections[0]?.status).toBeUndefined()
    }),
  )

  it.live(
    "renews the selected connection in place, preserves its label and active selection, and saves the new expiry",
    () =>
      Effect.gen(function* () {
        const test = yield* fixture(false, "opencode-test-client", true)
        const credentials = yield* Credential.Service
        const steps: Array<{ key: string; answer: Form.Answer }> = [
          { key: "team", answer: { team: "team_work" } },
          { key: "name", answer: { name: "Laptop key", expiration: "30" } },
          { key: "create", answer: { create: true } },
        ]
        for (const step of steps) {
          const pending = yield* test.status(
            (value) => value.status === "pending" && value.prompt?.fields[0]?.key === step.key,
          )
          if (pending.status !== "pending" || !pending.prompt) throw new Error("Missing renewal step")
          if (step.key === "name") expect(pending.prompt.fields[0]).toMatchObject({ default: "Laptop key" })
          yield* test.integrations.oauth.complete({ ...test.input, promptID: pending.prompt.id, answer: step.answer })
        }
        yield* test.status((value) => value.status === "complete")
        const saved = yield* credentials.list(integrationID)
        expect(saved).toHaveLength(2)
        expect(saved.find((value) => value.id === test.previous?.id)).toMatchObject({
          label: "Laptop",
          value: { type: "key", key: "gateway-key", metadata: { expiration: "30", expiresAt: expect.any(Number) } },
        })
        expect((yield* test.integrations.connection.active(integrationID))?.type).toBe("credential")
        expect((yield* test.integrations.get(integrationID))?.connections[0]).toMatchObject({ label: "Other" })
        expect(
          (yield* test.integrations.get(integrationID))?.connections.find(
            (value) => value.type === "credential" && value.id === test.previous?.id,
          )?.status,
        ).toBeUndefined()
      }),
  )

  it.live("keeps the old connection intact when renewal is denied", () =>
    Effect.gen(function* () {
      const test = yield* fixture(true, "opencode-test-client", true)
      const credentials = yield* Credential.Service
      yield* test.status((value) => value.status === "failed")
      expect(yield* credentials.get(test.previous!.id)).toEqual(test.previous)
      expect(test.requests.some((request) => request.path.startsWith("/v1/api-keys"))).toBe(false)
    }),
  )
  it.live("uses the temporary Vercel CLI client ID when no override is configured", () =>
    withEnv({ OPENCODE_VERCEL_CLIENT_ID: undefined }, () =>
      Effect.gen(function* () {
        const test = yield* fixture(false, "")
        const device = test.requests.find((request) => request.path === "/device")
        expect(new URLSearchParams(String(device?.body)).get("client_id")).toBe("cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp")
        yield* test.integrations.oauth.cancel(test.input)
      }),
    ),
  )

  it.live("allows a dedicated OAuth client ID to override the temporary default", () =>
    withEnv({ OPENCODE_VERCEL_CLIENT_ID: "dedicated-opencode-client" }, () =>
      Effect.gen(function* () {
        const test = yield* fixture(false, "")
        const device = test.requests.find((request) => request.path === "/device")
        expect(new URLSearchParams(String(device?.body)).get("client_id")).toBe("dedicated-opencode-client")
        yield* test.integrations.oauth.cancel(test.input)
      }),
    ),
  )
  it.live("signs in, interviews, creates a team key and stores only the Gateway credential", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      const credentials = yield* Credential.Service
      expect(test.attempt.url).toContain("/verify?code=TEST-CODE")
      const team = yield* test.status((value) => value.status === "pending" && !!value.prompt)
      if (team.status !== "pending" || !team.prompt) throw new Error("Missing team step")
      expect(team.prompt.fields[0]).toMatchObject({
        key: "team",
        options: [{ value: "team_work", label: "Work", description: "work" }],
      })
      yield* test.integrations.oauth.complete({
        ...test.input,
        promptID: team.prompt.id,
        answer: { team: "team_work" },
      })
      const settings = yield* test.status(
        (value) => value.status === "pending" && value.prompt?.title === "Create an AI Gateway key",
      )
      if (settings.status !== "pending" || !settings.prompt) throw new Error("Missing key settings")
      yield* test.integrations.oauth.complete({
        ...test.input,
        promptID: settings.prompt.id,
        answer: { name: "OpenCode laptop", expiration: "none" },
      })
      const review = yield* test.status(
        (value) => value.status === "pending" && value.prompt?.title === "Review Vercel AI Gateway setup",
      )
      if (review.status !== "pending" || !review.prompt) throw new Error("Missing review")
      expect(test.requests.some((request) => request.path.startsWith("/v1/api-keys"))).toBe(false)
      yield* test.integrations.oauth.complete({ ...test.input, promptID: review.prompt.id, answer: { create: true } })
      const complete = yield* test.status((value) => value.status === "complete")
      expect(complete).toMatchObject({
        status: "complete",
        next: { title: "Set a spending limit (optional)", url: "https://vercel.com/work/~/ai-gateway/api-keys" },
      })
      const creation = test.requests.find((request) => request.path.startsWith("/v1/api-keys"))
      expect(creation?.path).toBe("/v1/api-keys?teamId=team_work")
      expect(JSON.parse(String(creation?.body))).toEqual({ purpose: "ai-gateway", name: "OpenCode laptop" })
      expect((yield* credentials.list(integrationID))[0]?.value).toMatchObject({
        type: "key",
        key: "gateway-key",
        metadata: { teamID: "team_work", keyID: "key_1" },
      })
      expect(JSON.stringify(yield* credentials.list(integrationID))).not.toContain("vercel-access-token")
      expect(JSON.stringify(complete)).not.toContain("gateway-key")
    }),
  )

  it.live("does not create keys or credentials when Vercel sign-in is denied", () =>
    Effect.gen(function* () {
      const test = yield* fixture(true)
      const credentials = yield* Credential.Service
      expect(yield* test.status((value) => value.status === "failed")).toMatchObject({
        status: "failed",
        message: expect.stringContaining("denied"),
      })
      expect(test.requests.some((request) => request.path.startsWith("/v1/api-keys"))).toBe(false)
      expect(yield* credentials.list(integrationID)).toEqual([])
    }),
  )
})

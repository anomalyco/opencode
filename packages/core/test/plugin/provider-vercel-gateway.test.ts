import { describe, expect } from "bun:test"
import { Effect, Schedule } from "effect"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { make } from "@opencode/core/plugin/provider/vercel-gateway"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make("vercel")
const methodID = Integration.MethodID.make("gateway-setup")

const fixture = Effect.fn(function* (denied = false) {
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
  yield* make({ clientID: "opencode-test-client", issuer: server.url.origin, api: server.url.origin }).effect(host)
  const integrations = yield* Integration.Service
  const attempt = yield* integrations.oauth.connect({ integrationID, methodID })
  const input = { integrationID, attemptID: attempt.attemptID }
  const status = (ready: (value: Integration.AttemptStatus) => boolean) =>
    integrations.oauth
      .status(input)
      .pipe(
        Effect.repeat({ while: (value) => !ready(value), schedule: Schedule.spaced("1 millis") }),
        Effect.timeout("5 seconds"),
      )
  return { requests, integrations, attempt, input, status }
})

describe("Vercel AI Gateway setup", () => {
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

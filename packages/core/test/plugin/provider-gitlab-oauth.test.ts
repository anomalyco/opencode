import { describe, expect } from "bun:test"
import { Clock, Effect, Schedule } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { GitLabPlugin } from "@opencode/core/plugin/provider/gitlab"
import { ProviderPlugins } from "@opencode/core/plugin/provider"
import { withEnv } from "../fixture/env"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make("gitlab")
const methodID = Integration.MethodID.make("pkce")
const bundledClientID = "fd180700a8f9c5d5557aca231632dd0611a1135a3bb510a741d5a988a3394fa7"
const legacyClientID = "1d89f9fdb23ee96d4e603201f6861dab6e143c5c3c00469a018a2d94bdc03d4e"
const renewal = () =>
  Response.json({ access_token: "renewed-access", refresh_token: "renewed-refresh", expires_in: 3600 })
// Refresh outcomes are shared per refresh token across the process, so every test spends its own.
const expired = (metadata: Record<string, string>) =>
  Credential.OAuth.make({
    type: "oauth",
    methodID,
    access: "stale-access",
    refresh: `refresh-${crypto.randomUUID()}`,
    expires: 1,
    metadata,
  })
const connectionOf = (saved: Credential.Info) => ({
  type: "credential" as const,
  id: saved.id,
  label: saved.label,
  method: "oauth" as const,
})
const tokenRequests = (requests: Request[]) =>
  Effect.promise(() =>
    Promise.all(
      requests
        .filter((request) => request.url.endsWith("/oauth/token"))
        .map(async (request) => ({
          url: request.url,
          form: Object.fromEntries(new URLSearchParams(await request.text())),
        })),
    ),
  )

const fixture = Effect.fn(function* () {
  const requests: Request[] = []
  const replies: (Response | Effect.Effect<Response>)[] = []
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      requests.push(yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie))
      const response = replies.shift()
      if (!response) throw new Error(`Unexpected request: ${request.url}`)
      return HttpClientResponse.fromWeb(request, yield* Effect.isEffect(response) ? response : Effect.succeed(response))
    }),
  )
  const integrations = yield* Integration.Service
  const credentials = yield* Credential.Service
  yield* integrations.transform((editor) => {
    editor.method.update({ integrationID, method: { type: "key" } })
  })
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* GitLabPlugin.effect(host).pipe(Effect.provideService(HttpClient.HttpClient, http))
  const status = (attemptID: Integration.AttemptID) =>
    integrations.oauth
      .status({ integrationID, attemptID })
      .pipe(
        Effect.repeat({ until: (value) => value.status !== "pending", schedule: Schedule.spaced("1 millis") }),
        Effect.timeout("3 seconds"),
      )
  const connect = Effect.gen(function* () {
    const attempt = yield* integrations.oauth.connect({ integrationID, methodID, label: "GitLab login" })
    const url = new URL(attempt.url)
    const callback = new URL(url.searchParams.get("redirect_uri") ?? "")
    callback.searchParams.set("state", url.searchParams.get("state") ?? "")
    callback.searchParams.set("code", "auth-code")
    return { attempt, url, callback }
  })
  return { requests, replies, integrations, credentials, status, connect }
})

describe("GitLabPlugin OAuth", () => {
  it.effect("is registered alongside the other provider plugins", () =>
    Effect.gen(function* () {
      expect(ProviderPlugins).toContain(GitLabPlugin)
    }),
  )

  it.effect("registers PKCE OAuth alongside the generic key/env methods from ModelsDevPlugin", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      yield* integrations.transform((editor) => {
        editor.method.update({ integrationID, method: { type: "key" } })
        editor.method.update({ integrationID, method: { type: "env", names: ["GITLAB_TOKEN"] } })
      })
      const test = yield* fixture()
      expect((yield* integrations.get(integrationID))?.methods).toEqual([
        { type: "key" },
        { type: "env", names: ["GITLAB_TOKEN"] },
        {
          id: methodID,
          type: "oauth",
          label: "Login with GitLab (OAuth)",
          form: [
            {
              type: "string",
              key: "instanceUrl",
              title: "GitLab instance URL",
              description: "Leave the default to use gitlab.com, or enter your self-managed GitLab URL.",
              placeholder: "https://gitlab.com",
              default: "https://gitlab.com",
              pattern: "^https?://\\S+$",
            },
          ],
        },
      ])
      expect(test.requests).toHaveLength(0)
    }),
  )

  it.live("exchanges a PKCE code for a native GitLab OAuth credential against gitlab.com by default", () =>
    withEnv({ GITLAB_OAUTH_CLIENT_ID: undefined }, () =>
      Effect.gen(function* () {
        const test = yield* fixture()
        const login = yield* test.connect
        expect(login.url.origin + login.url.pathname).toBe("https://gitlab.com/oauth/authorize")
        expect(Object.fromEntries(login.url.searchParams)).toMatchObject({
          response_type: "code",
          client_id: bundledClientID,
          scope: "api",
          code_challenge_method: "S256",
        })
        expect(login.url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8080/callback")
        expect(login.callback.hostname).toBe("127.0.0.1")
        expect(login.callback.port).toBe("8080")
        expect(login.callback.pathname).toBe("/callback")

        const now = Date.now()
        test.replies.push(
          Response.json({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 7200 }),
        )
        const page = yield* Effect.promise(() => fetch(login.callback, { headers: { Connection: "close" } }))
        expect(page.status).toBe(200)
        expect(yield* Effect.promise(() => page.text())).toContain("Authorization successful")
        expect((yield* test.status(login.attempt.attemptID)).status).toBe("complete")

        const exchange = test.requests[0]
        expect(exchange.url).toBe("https://gitlab.com/oauth/token")
        expect(exchange.headers.get("content-type")).toContain("application/x-www-form-urlencoded")
        const form = new URLSearchParams(yield* Effect.promise(() => exchange.text()))
        expect(Object.fromEntries(form)).toMatchObject({
          grant_type: "authorization_code",
          client_id: bundledClientID,
          code: "auth-code",
          redirect_uri: "http://127.0.0.1:8080/callback",
        })
        expect(login.url.searchParams.get("code_challenge")).toBe(
          Buffer.from(
            yield* Effect.promise(() =>
              crypto.subtle.digest("SHA-256", new TextEncoder().encode(form.get("code_verifier") ?? "")),
            ),
          ).toString("base64url"),
        )

        const saved = (yield* test.credentials.list(integrationID))[0]?.value
        if (saved?.type !== "oauth") throw new Error("Expected OAuth credential")
        expect(saved.access).toBe("access-token")
        expect(saved.refresh).toBe("refresh-token")
        expect(saved.metadata).toEqual({ instanceUrl: "https://gitlab.com", clientID: bundledClientID })
        expect(saved.expires).toBeGreaterThanOrEqual(now + 7_200_000)
        expect(saved.expires).toBeLessThanOrEqual(Date.now() + 7_200_000)
      }),
    ),
  )

  it.live("uses the answered self-managed instance URL, including a relative URL root", () =>
    withEnv({ GITLAB_OAUTH_CLIENT_ID: "self-managed-client" }, () =>
      Effect.gen(function* () {
        const test = yield* fixture()
        const attempt = yield* test.integrations.oauth.connect({
          integrationID,
          methodID,
          answer: { instanceUrl: "https://example.com/gitlab/" },
        })
        const url = new URL(attempt.url)
        expect(url.origin + url.pathname).toBe("https://example.com/gitlab/oauth/authorize")
        const callback = new URL(url.searchParams.get("redirect_uri") ?? "")
        callback.searchParams.set("state", url.searchParams.get("state") ?? "")
        callback.searchParams.set("code", "auth-code")
        test.replies.push(
          Response.json({ access_token: "access-token", refresh_token: "refresh-token", expires_in: 3600 }),
        )
        yield* Effect.promise(() => fetch(callback, { headers: { Connection: "close" } }))
        expect((yield* test.status(attempt.attemptID)).status).toBe("complete")
        expect(test.requests[0]?.url).toBe("https://example.com/gitlab/oauth/token")
        const saved = (yield* test.credentials.list(integrationID))[0]
        expect(saved?.value.metadata).toEqual({
          instanceUrl: "https://example.com/gitlab",
          clientID: "self-managed-client",
        })
        // Without an explicit label, the method's label hook names the credential after the host.
        expect(saved?.label).toBe("example.com")
        expect(yield* test.integrations.connection.active(integrationID)).toMatchObject({
          type: "credential",
          label: "example.com",
        })
      }),
    ),
  )

  it.effect("fails early for self-managed instances without GITLAB_OAUTH_CLIENT_ID", () =>
    withEnv({ GITLAB_OAUTH_CLIENT_ID: undefined }, () =>
      Effect.gen(function* () {
        const test = yield* fixture()
        const error = yield* test.integrations.oauth
          .connect({ integrationID, methodID, answer: { instanceUrl: "https://gitlab.example.com" } })
          .pipe(Effect.flip)
        expect(error.message).toContain("only exists on gitlab.com")
        expect(error.message).toContain("GITLAB_OAUTH_CLIENT_ID")
        expect(error.message).toContain("gitlab.example.com")
        expect(test.requests).toHaveLength(0)
      }),
    ),
  )

  it.effect("refreshes an OAuth credential using its stored instance URL and includes redirect_uri", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      // Creating the credential also wakes workflow discovery, which resolves the same expired
      // credential. Both must share one refresh: GitLab rotates the refresh token on use.
      test.replies.push(renewal())
      const saved = yield* test.credentials.create({
        integrationID,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID,
          access: "stale-access",
          refresh: "stored-refresh",
          expires: 1,
          metadata: { instanceUrl: "https://gitlab.example.com", clientID: bundledClientID },
        }),
      })
      const now = yield* Clock.currentTimeMillis
      const resolved = yield* test.integrations.connection.resolve(connectionOf(saved))
      if (resolved?.type !== "oauth") throw new Error("Expected OAuth credential")
      expect(resolved.access).toBe("renewed-access")
      expect(resolved.refresh).toBe("renewed-refresh")
      expect(resolved.expires).toBeGreaterThanOrEqual(now + 3_600_000)
      expect(resolved.metadata).toEqual({ instanceUrl: "https://gitlab.example.com", clientID: bundledClientID })

      const requests = yield* tokenRequests(test.requests)
      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe("https://gitlab.example.com/oauth/token")
      expect(requests[0]?.form).toMatchObject({
        grant_type: "refresh_token",
        refresh_token: "stored-refresh",
        client_id: bundledClientID,
        redirect_uri: "http://127.0.0.1:8080/callback",
      })
    }),
  )

  it.live("shares one token exchange between concurrent refreshes of the same credential", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      test.replies.push(Effect.sleep("50 millis").pipe(Effect.as(renewal())))
      const saved = yield* test.credentials.create({
        integrationID,
        value: expired({ instanceUrl: "https://gitlab.com", clientID: bundledClientID }),
      })
      const resolved = yield* Effect.all(
        Array.from({ length: 3 }, () => test.integrations.connection.resolve(connectionOf(saved))),
        { concurrency: "unbounded" },
      )
      expect(resolved.map((value) => (value?.type === "oauth" ? value.access : undefined))).toEqual([
        "renewed-access",
        "renewed-access",
        "renewed-access",
      ])
      expect(yield* tokenRequests(test.requests)).toHaveLength(1)
    }),
  )

  it.effect("falls back to the opencode-gitlab-auth application for credentials without a client ID", () =>
    withEnv({ GITLAB_OAUTH_CLIENT_ID: undefined }, () =>
      Effect.gen(function* () {
        const test = yield* fixture()
        test.replies.push(
          new Response(JSON.stringify({ error: "invalid_grant", error_description: "The provided grant is invalid" }), {
            status: 400,
          }),
          renewal(),
        )
        const saved = yield* test.credentials.create({
          integrationID,
          value: expired({ instanceUrl: "https://gitlab.com" }),
        })
        const resolved = yield* test.integrations.connection.resolve(connectionOf(saved))
        if (resolved?.type !== "oauth") throw new Error("Expected OAuth credential")
        expect(resolved.access).toBe("renewed-access")
        // The working application is recorded so later refreshes skip the fallback.
        expect(resolved.metadata).toEqual({ instanceUrl: "https://gitlab.com", clientID: legacyClientID })
        const requests = yield* tokenRequests(test.requests)
        expect(requests.map((request) => request.form.client_id)).toEqual([bundledClientID, legacyClientID])
        const refresh = saved.value.type === "oauth" ? saved.value.refresh : ""
        expect(requests.map((request) => request.form.refresh_token)).toEqual([refresh, refresh])
      }),
    ),
  )

  it.effect("refreshes only with the recorded client ID when the credential has one", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      test.replies.push(renewal())
      const saved = yield* test.credentials.create({
        integrationID,
        value: expired({ instanceUrl: "https://gitlab.com", clientID: legacyClientID }),
      })
      yield* test.integrations.connection.resolve(connectionOf(saved))
      const requests = yield* tokenRequests(test.requests)
      expect(requests.map((request) => request.form.client_id)).toEqual([legacyClientID])
    }),
  )

  it.effect("reports a revoked refresh token with a sign-in-again hint instead of authorization-code hints", () =>
    Effect.gen(function* () {
      const test = yield* fixture()
      test.replies.push(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }))
      const saved = yield* test.credentials.create({
        integrationID,
        value: expired({ instanceUrl: "https://gitlab.com", clientID: bundledClientID }),
      })
      const error = yield* test.integrations.connection.resolve(connectionOf(saved)).pipe(Effect.flip)
      expect(error.message).toContain("refresh token was revoked, expired")
      expect(error.message).toContain("Sign in to GitLab again")
      expect(error.message).not.toContain("authorization code")
      expect(yield* tokenRequests(test.requests)).toHaveLength(1)
    }),
  )

  for (const invalid of [
    { params: { state: "" }, message: "Invalid OAuth state" },
    { params: { code: "" }, message: "Missing authorization code" },
    { params: { error: "access_denied", error_description: "User declined access" }, message: "User declined access" },
    { params: { error: "access_denied" }, message: "access_denied" },
  ]) {
    it.live(`rejects invalid or denied callbacks (${JSON.stringify(invalid.params)})`, () =>
      Effect.gen(function* () {
        const test = yield* fixture()
        const login = yield* test.connect
        Object.entries(invalid.params).forEach(([key, value]) => login.callback.searchParams.set(key, value))
        const response = yield* Effect.promise(() => fetch(login.callback, { headers: { Connection: "close" } }))
        expect(response.status).toBe(400)
        expect(yield* Effect.promise(() => response.text())).toContain("Authorization failed")
        expect(yield* test.status(login.attempt.attemptID)).toMatchObject({
          status: "failed",
          message: invalid.message,
        })
        expect(test.requests).toHaveLength(0)
        expect(yield* test.credentials.list(integrationID)).toEqual([])
      }),
    )
  }

  for (const response of [
    {
      status: 400,
      body: JSON.stringify({ error: "invalid_grant", error_description: "Code expired" }),
      contains: "Code expired",
    },
    {
      status: 400,
      body: JSON.stringify({ error: "invalid_grant" }),
      contains: "client_id used:",
    },
    { status: 502, body: "Bad gateway", contains: "HTTP 502" },
  ]) {
    it.live(`preserves the active connection after a failed token exchange (${response.status})`, () =>
      Effect.gen(function* () {
        const test = yield* fixture()
        yield* test.integrations.connection.key({ integrationID, key: "previous-key" })
        const previous = yield* test.integrations.connection.active(integrationID)
        const saved = yield* test.credentials.list(integrationID)
        const login = yield* test.connect
        test.replies.push(new Response(response.body, { status: response.status }))
        const page = yield* Effect.promise(() => fetch(login.callback, { headers: { Connection: "close" } }))
        expect(page.status).toBe(400)
        const text = yield* Effect.promise(() => page.text())
        expect(text).toContain(response.contains)
        expect(yield* test.credentials.list(integrationID)).toEqual(saved)
        expect(yield* test.integrations.connection.active(integrationID)).toEqual(previous)
      }),
    )
  }

  it.live("reports EADDRINUSE with a clear message when the callback port is occupied", () =>
    Effect.gen(function* () {
      const { createServer } = yield* Effect.promise(() => import("node:http"))
      const { EventEmitter } = yield* Effect.promise(() => import("node:events"))
      const blocker = createServer()
      yield* Effect.tryPromise(() => EventEmitter.once(blocker.listen(8080, "127.0.0.1"), "listening"))
      yield* Effect.addFinalizer(() => Effect.sync(() => blocker.close()))
      const test = yield* fixture()
      const error = yield* test.integrations.oauth.connect({ integrationID, methodID }).pipe(Effect.flip)
      expect(error.message).toContain("port 8080")
      expect(error.message).toContain("already in use")
    }),
  )

  it.live("honors GITLAB_OAUTH_CLIENT_ID for self-managed applications", () =>
    withEnv({ GITLAB_OAUTH_CLIENT_ID: "custom-client-id" }, () =>
      Effect.gen(function* () {
        const test = yield* fixture()
        const login = yield* test.connect
        expect(login.url.searchParams.get("client_id")).toBe("custom-client-id")
        test.replies.push(Response.json({ access_token: "a", refresh_token: "r", expires_in: 3600 }))
        yield* Effect.promise(() => fetch(login.callback, { headers: { Connection: "close" } }))
        expect((yield* test.status(login.attempt.attemptID)).status).toBe("complete")
        const form = new URLSearchParams(yield* Effect.promise(() => test.requests[0]?.text() ?? Promise.resolve("")))
        expect(form.get("client_id")).toBe("custom-client-id")
      }),
    ),
  )
})

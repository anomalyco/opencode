import { describe, expect } from "bun:test"
import { App } from "@opencode/core/app"
import { CopilotOAuth } from "@opencode/core/github-copilot/oauth"
import { Credential } from "@opencode/schema/credential"
import { Integration } from "@opencode/schema/integration"
import { Clock, Effect, Fiber } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { it } from "../lib/effect"

const renewed = () => ({
  access_token: "new-access",
  refresh_token: "new-refresh",
  expires_in: 28800,
  refresh_token_expires_in: 15897600,
})
const saved = (metadata: Record<string, unknown> = {}) =>
  Credential.OAuth.make({
    type: "oauth",
    methodID: Integration.MethodID.make("device"),
    access: "old-access",
    refresh: "old-refresh",
    expires: 1,
    metadata: { refreshable: true, ...metadata },
  })

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected an OAuth request")
  return value
}

function fixture(expiring = false) {
  const requests: Request[] = []
  const replies: Response[] = []
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      requests.push(yield* HttpClientRequest.toWeb(request).pipe(Effect.orDie))
      const response = replies.shift()
      if (!response) return yield* Effect.die(new Error(`Unexpected request: ${request.url}`))
      return HttpClientResponse.fromWeb(request, response)
    }),
  )
  return {
    requests,
    replies,
    auth: CopilotOAuth.method(App.make({ name: "test" }), http, Effect.succeed(expiring)),
    login: (token: object) =>
      replies.push(
        Response.json({
          device_code: "device-code",
          user_code: "USER-CODE",
          verification_uri: "https://github.com/login/device",
          interval: 5,
        }),
        Response.json(token),
        Response.json({ endpoints: { api: "https://api.business.githubcopilot.com/" } }),
      ),
  }
}

describe("Copilot OAuth", () => {
  for (const expiring of [false, true])
    it.effect(`stores issued token pairs with the request flag ${expiring}`, () =>
      Effect.gen(function* () {
        const test = fixture(expiring)
        test.login(renewed())
        const now = yield* Clock.currentTimeMillis
        const authorization = yield* test.auth.authorize({ deploymentType: "github.com" })
        const value = yield* authorization.callback
        expect(value).toEqual({
          type: "oauth",
          methodID: Integration.MethodID.make("device"),
          access: "new-access",
          refresh: "new-refresh",
          expires: now + 28800000,
          metadata: {
            apiEndpoint: "https://api.business.githubcopilot.com",
            refreshable: true,
            refreshExpires: now + 15897600000,
          },
        })
        expect(yield* Effect.promise(() => required(test.requests[0]).json())).toMatchObject({
          scope: expiring ? "read:user offline_access" : "read:user",
        })
        expect(test.requests[2]?.headers.get("authorization")).toBe("Bearer new-access")
      }),
    )

  it.effect("keeps non-expiring server responses compatible", () =>
    Effect.gen(function* () {
      const test = fixture(true)
      test.login({ access_token: "legacy" })
      const authorization = yield* test.auth.authorize({ deploymentType: "github.com" })
      const value = yield* authorization.callback
      expect(value.access).toBe("legacy")
      expect(value.refresh).toBe("legacy")
      expect(value.expires).toBe(0)
      expect(value.metadata?.refreshable).toBeUndefined()
    }),
  )

  for (const domain of ["company.ghe.com", "github.company.test"])
    it.effect(`preserves the issuer and scopes for ${domain}`, () =>
      Effect.gen(function* () {
        const test = fixture(true)
        test.login(renewed())
        const authorization = yield* test.auth.authorize({
          deploymentType: "enterprise",
          enterpriseUrl: `https://${domain}/`,
        })
        const value = yield* authorization.callback
        expect(test.requests[0]?.url).toBe(`https://${domain}/login/device/code`)
        expect(yield* Effect.promise(() => required(test.requests[0]).json())).toMatchObject({
          scope: domain.endsWith(".ghe.com") ? "read:user offline_access" : "read:user",
        })
        test.replies.push(Response.json(renewed()))
        yield* test.auth.refresh(value)
        expect(test.requests.at(-1)?.url).toBe(`https://${domain}/login/oauth/access_token`)
        expect(value.metadata?.enterpriseUrl).toBe(domain)
      }),
    )

  it.effect("anchors expiration to the successful device exchange after polling", () =>
    Effect.gen(function* () {
      const test = fixture()
      test.login(renewed())
      test.replies.splice(1, 0, Response.json({ error: "authorization_pending" }))
      const authorization = yield* test.auth.authorize({ deploymentType: "github.com" })
      const pending = yield* authorization.callback.pipe(Effect.forkChild({ startImmediately: true }))
      yield* TestClock.adjust("8 seconds")
      const value = yield* Fiber.join(pending)
      expect(value.expires).toBe((yield* Clock.currentTimeMillis) + 28800000)
    }),
  )

  it.effect("rotates the pair through the refresh grant while retaining metadata", () =>
    Effect.gen(function* () {
      const test = fixture()
      test.replies.push(Response.json(renewed()))
      const value = yield* test.auth.refresh(
        saved({ apiEndpoint: "https://api.business.githubcopilot.com", custom: "kept" }),
      )
      expect(value.refresh).toBe("new-refresh")
      expect(value.access).toBe("new-access")
      expect(value.metadata).toMatchObject({ custom: "kept", apiEndpoint: "https://api.business.githubcopilot.com" })
      expect(yield* Effect.promise(() => required(test.requests[0]).json())).toEqual({
        client_id: "Ov23li8tweQw6odWQebz",
        grant_type: "refresh_token",
        refresh_token: "old-refresh",
      })
      expect(test.requests[0]?.headers.has("authorization")).toBe(false)
    }),
  )

  it.effect("reuses an omitted refresh token without extending its recorded expiry", () =>
    Effect.gen(function* () {
      const test = fixture()
      test.replies.push(Response.json({ access_token: "new-access", expires_in: 3600 }))
      const value = yield* test.auth.refresh(saved({ refreshExpires: 100000 }))
      expect(value.refresh).toBe("old-refresh")
      expect(value.metadata?.refreshExpires).toBe(100000)
    }),
  )

  it.effect("does not apply an old refresh expiry to a new refresh token", () =>
    Effect.gen(function* () {
      const test = fixture()
      test.replies.push(Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }))
      const value = yield* test.auth.refresh(saved({ refreshExpires: 100000 }))
      expect(value.metadata?.refreshExpires).toBeUndefined()
    }),
  )

  it.effect("never exchanges a legacy access-in-refresh credential as a refresh token", () =>
    Effect.gen(function* () {
      const test = fixture()
      const legacy = Credential.OAuth.make({
        type: "oauth",
        methodID: Integration.MethodID.make("device"),
        access: "old-copilot-token",
        refresh: "github-token",
        expires: 1,
      })
      expect(CopilotOAuth.access(legacy)).toBe("github-token")
      const value = yield* test.auth.refresh(legacy)
      expect(value.access).toBe("github-token")
      expect(value.expires).toBe(0)
      expect(test.requests).toHaveLength(0)
    }),
  )

  it.effect("requires sign-in when the refresh token has expired without making a request", () =>
    Effect.gen(function* () {
      const test = fixture()
      const error = yield* test.auth.refresh(saved({ refreshExpires: 0 })).pipe(Effect.flip)
      expect(String(error)).toContain("opencode auth login")
      expect(test.requests).toHaveLength(0)
    }),
  )

  for (const status of [200, 400])
    for (const error of ["bad_refresh_token", "invalid_grant"])
      it.effect(`requires sign-in for ${error} (${status})`, () =>
        Effect.gen(function* () {
          const test = fixture()
          test.replies.push(Response.json({ error }, { status }))
          const failure = yield* test.auth.refresh(saved()).pipe(Effect.flip)
          expect(String(failure)).toContain("opencode auth login")
        }),
      )

  it.effect("does not classify a server failure as a revoked authorization", () =>
    Effect.gen(function* () {
      const test = fixture()
      test.replies.push(Response.json({ error: "invalid_grant" }, { status: 503 }))
      const failure = yield* test.auth.refresh(saved()).pipe(Effect.flip)
      expect(String(failure)).toContain("Try again")
      expect(String(failure)).not.toContain("opencode auth login")
    }),
  )

  for (const body of [
    { ...renewed(), expires_in: -1 },
    { ...renewed(), expires_in: undefined },
    { ...renewed(), access_token: undefined },
  ])
    it.effect(
      `rejects invalid token data without including secrets: ${Object.keys(body).join(",")}:${body.expires_in}`,
      () =>
        Effect.gen(function* () {
          const test = fixture()
          test.replies.push(Response.json(body))
          const failure = yield* test.auth.refresh(saved()).pipe(Effect.flip)
          expect(String(failure)).not.toContain("new-access")
          expect(String(failure)).not.toContain("new-refresh")
        }),
    )
})

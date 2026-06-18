import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/core/integration"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { NoumenaPlugin } from "@opencode-ai/core/plugin/provider/noumena"
import { manual } from "@opencode-ai/core/plugin/provider/noumena-auth"
import { it, withEnv } from "./provider-helper"

function add(plugin: PluginV2.Interface, integrations: Integration.Interface) {
  return plugin.add({
    ...NoumenaPlugin,
    effect: NoumenaPlugin.effect.pipe(Effect.provideService(Integration.Service, integrations)),
  })
}

describe("NoumenaPlugin", () => {
  it.effect("registers browser and manual OAuth methods", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      yield* add(plugin, yield* Integration.Service)
      expect((yield* (yield* Integration.Service).get(Integration.ID.make("noumena")))?.methods).toEqual([
        {
          id: Integration.MethodID.make("noumena-browser"),
          type: "oauth",
          label: "Noumena Code (browser)",
        },
        {
          id: Integration.MethodID.make("noumena-code"),
          type: "oauth",
          label: "Noumena Code (manual code)",
        },
      ])
    }),
  )

  it.effect("uses ncode-compatible env overrides in manual OAuth flow", () =>
    withEnv(
      {
        NOUMENA_ISSUER_BASE_URL: "https://issuer.noumena.test/",
        NOUMENA_OAUTH_WEB_BASE_URL: "https://code.noumena.test/",
        NOUMENA_OAUTH_CLIENT_ID: "custom-client",
      },
      () =>
        withFetch(async (input, init) => {
          expect(input).toBe("https://issuer.noumena.test/oauth/token")
          expect(init?.headers).toMatchObject({ "anthropic-beta": "oauth-2025-04-20" })
          const body = new URLSearchParams(String(init?.body))
          expect(body.get("grant_type")).toBe("authorization_code")
          expect(body.get("code")).toBe("pasted-code")
          expect(body.get("client_id")).toBe("custom-client")
          expect(body.get("redirect_uri")).toBe("https://code.noumena.test/oauth/code/callback?app=noumena-code")
          expect(body.get("code_verifier")).toBeTruthy()
          expect(body.get("state")).toBeTruthy()
          return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 60 }))
        }, () =>
          Effect.gen(function* () {
            const authorization = yield* manual.authorize()
            expect(authorization.mode).toBe("code")
            const url = new URL(authorization.url)
            expect(url.origin + url.pathname).toBe("https://code.noumena.test/oauth/authorize")
            expect(url.searchParams.get("client_id")).toBe("custom-client")
            expect(url.searchParams.get("scope")).toBe(
              "user:profile user:inference user:sessions:ncode user:mcp_servers user:file_upload",
            )
            if (authorization.mode !== "code") throw new Error("expected code mode")
            const credential = yield* authorization.callback("pasted-code")
            expect(credential).toMatchObject({ type: "oauth", access: "access", refresh: "refresh" })
          }),
        ),
    ),
  )

  it.effect("refreshes OAuth tokens with refresh-token grant", () =>
    withFetch(async (input, init) => {
      expect(input).toBe("https://api.noumena.com/oauth/token")
      const body = new URLSearchParams(String(init?.body))
      expect(body.get("grant_type")).toBe("refresh_token")
      expect(body.get("refresh_token")).toBe("old-refresh")
      expect(body.get("client_id")).toBe("noumena-code")
      expect(body.get("scope")).toBe("user:profile user:inference user:sessions:ncode user:mcp_servers user:file_upload")
      return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 60 }))
    }, () =>
      Effect.gen(function* () {
        const refreshed = yield* manual.refresh!(
          new Credential.OAuth({
            type: "oauth",
            methodID: Integration.MethodID.make("noumena-code"),
            access: "old-access",
            refresh: "old-refresh",
            expires: Date.now() - 1,
          }),
        )
        expect(refreshed.access).toBe("new-access")
        expect(refreshed.refresh).toBe("new-refresh")
      }),
    ),
  )

})

function withFetch<A, E, R>(
  fetch: (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => Promise<Response>,
  fx: () => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.fetch
      globalThis.fetch = Object.assign(fetch, { preconnect: previous.preconnect }) as typeof globalThis.fetch
      return previous
    }),
    () => fx(),
    (previous) =>
      Effect.sync(() => {
        globalThis.fetch = previous
      }),
  )
}

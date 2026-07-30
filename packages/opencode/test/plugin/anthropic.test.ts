import { describe, expect, test } from "bun:test"
import { stat } from "node:fs/promises"
import path from "node:path"
import {
  ANTHROPIC_AUXILIARY_BETA,
  ANTHROPIC_BETA,
  ANTHROPIC_VERSION,
  AUTHORIZE_SCOPES,
  CLAUDE_AGENT_IDENTITY,
  CLAUDE_CODE_AUXILIARY_BILLING,
  CLAUDE_CODE_BILLING,
  CLIENT_ID,
  ClaudeAuthPlugin,
  REFRESH_SCOPES,
  SUCCESS_ENDPOINT,
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  generatePKCE,
  loadClaudeDeviceID,
  refreshAccessToken,
  requestProfile,
} from "../../src/plugin/anthropic/claude"
import { tmpdir } from "../fixture/fixture"

type AuthUpdate = {
  path: { id: string }
  body: {
    type: "oauth"
    refresh: string
    access: string
    expires: number
    accountId?: string
  }
}

function pluginInput(set: (input: AuthUpdate) => Promise<void> = async () => {}) {
  return {
    client: {
      auth: { set },
    },
    project: {},
    directory: "",
    worktree: "",
    experimental_workspace: {
      register() {},
    },
    serverUrl: new URL("https://example.com"),
    $: {},
  } as never
}

describe("plugin.anthropic", () => {
  test("builds the captured PKCE authorization request", async () => {
    const pkce = await generatePKCE()
    const url = new URL(
      buildAuthorizeUrl({
        redirectUri: "http://localhost:3210/callback",
        challenge: pkce.challenge,
        state: "state-test",
      }),
    )
    const expectedChallenge = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pkce.verifier)),
    ).toString("base64url")

    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(pkce.challenge).toBe(expectedChallenge)
    expect(url.origin + url.pathname).toBe("https://claude.com/cai/oauth/authorize")
    expect(url.searchParams.get("code")).toBe("true")
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID)
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3210/callback")
    expect(url.searchParams.get("scope")).toBe(AUTHORIZE_SCOPES.join(" "))
    expect(AUTHORIZE_SCOPES.join(" ")).toBe(
      "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
    )
    expect(REFRESH_SCOPES.join(" ")).toBe(
      "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
    )
    expect(ANTHROPIC_VERSION).toBe("2023-06-01")
    expect(ANTHROPIC_BETA).toBe(
      "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,thinking-token-count-2026-05-13,context-management-2025-06-27,prompt-caching-scope-2026-01-05,mid-conversation-system-2026-04-07,advisor-tool-2026-03-01,effort-2025-11-24,extended-cache-ttl-2025-04-11,cache-diagnosis-2026-04-07",
    )
    expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge)
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("state")).toBe("state-test")
  })

  test("sends captured JSON token exchange and refresh payloads", async () => {
    const requests: Array<{
      body: Record<string, string>
      contentType: string | null
      userAgent: string | null
    }> = []

    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as Record<string, string>
        requests.push({
          body,
          contentType: request.headers.get("content-type"),
          userAgent: request.headers.get("user-agent"),
        })
        if (body.grant_type === "authorization_code") {
          return Response.json({
            access_token: "access-initial",
            refresh_token: "refresh-initial",
            expires_in: 3600,
            refresh_token_expires_in: 2_592_000,
            scope: AUTHORIZE_SCOPES.join(" "),
          })
        }
        return Response.json({
          access_token: "access-refreshed",
          expires_in: 1800,
          scope: REFRESH_SCOPES.join(" "),
        })
      },
    })

    const endpoint = new URL("/v1/oauth/token", server.url).toString()
    const exchanged = await exchangeAuthorizationCode({
      code: "authorization-code",
      redirectUri: "http://localhost:3210/callback",
      verifier: "pkce-verifier",
      state: "oauth-state",
      endpoint,
    })
    const refreshed = await refreshAccessToken({
      refresh: "refresh-initial",
      endpoint,
    })

    expect(exchanged).toEqual({
      access_token: "access-initial",
      refresh_token: "refresh-initial",
      expires_in: 3600,
      refresh_token_expires_in: 2_592_000,
      scope: AUTHORIZE_SCOPES.join(" "),
    })
    expect(refreshed).toEqual({
      access_token: "access-refreshed",
      expires_in: 1800,
      scope: REFRESH_SCOPES.join(" "),
    })
    expect(requests).toEqual([
      {
        body: {
          grant_type: "authorization_code",
          code: "authorization-code",
          redirect_uri: "http://localhost:3210/callback",
          client_id: CLIENT_ID,
          code_verifier: "pkce-verifier",
          state: "oauth-state",
        },
        contentType: "application/json",
        userAgent: "claude-cli/2.1.220 (external, sdk-cli)",
      },
      {
        body: {
          grant_type: "refresh_token",
          refresh_token: "refresh-initial",
          client_id: CLIENT_ID,
          scope: REFRESH_SCOPES.join(" "),
        },
        contentType: "application/json",
        userAgent: "claude-cli/2.1.220 (external, sdk-cli)",
      },
    ])
  })

  test("persists Claude Code's random 64-hex device ID with private permissions", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "claude-device-id")
    const [first, second] = await Promise.all([loadClaudeDeviceID(filepath), loadClaudeDeviceID(filepath)])
    const seededPath = path.join(tmp.path, "seeded-device-id")
    const seeded = "f".repeat(64)
    await Bun.write(seededPath, seeded)
    const corruptPath = path.join(tmp.path, "corrupt-device-id")
    await Bun.write(corruptPath, "not-a-device-id")
    const repaired = await loadClaudeDeviceID(corruptPath)

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).toBe(first)
    expect(await Bun.file(filepath).text()).toBe(first)
    expect(await loadClaudeDeviceID(seededPath)).toBe(seeded)
    expect(repaired).toMatch(/^[0-9a-f]{64}$/)
    expect(repaired).not.toBe("not-a-device-id")
    expect(await Bun.file(corruptPath).text()).toBe(repaired)
    if (process.platform !== "win32") {
      expect((await stat(filepath)).mode & 0o777).toBe(0o600)
      expect((await stat(seededPath)).mode & 0o777).toBe(0o600)
      expect((await stat(corruptPath)).mode & 0o777).toBe(0o600)
    }
  })

  test("loads the OAuth profile with the captured request headers", async () => {
    const requests: Array<{
      method: string
      authorization: string | null
      cacheControl: string | null
      contentType: string | null
      userAgent: string | null
    }> = []

    using server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push({
          method: request.method,
          authorization: request.headers.get("authorization"),
          cacheControl: request.headers.get("cache-control"),
          contentType: request.headers.get("content-type"),
          userAgent: request.headers.get("user-agent"),
        })
        return Response.json({ account: { uuid: "account-test" } })
      },
    })

    const accountID = await requestProfile({
      access: "access-profile",
      endpoint: new URL("/api/oauth/profile", server.url).toString(),
    })

    expect(accountID).toBe("account-test")
    expect(requests).toEqual([
      {
        method: "GET",
        authorization: "Bearer access-profile",
        cacheControl: "no-cache",
        contentType: "application/json",
        userAgent: "claude-cli/2.1.220 (external, sdk-cli)",
      },
    ])
  })

  test("rejects an OAuth profile without an account UUID", async () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ account: {} })
      },
    })

    await expect(
      requestProfile({
        access: "access-profile",
        endpoint: new URL("/api/oauth/profile", server.url).toString(),
      }),
    ).rejects.toThrow("Claude profile response is missing account.uuid")
  })

  test("loads and persists a missing account ID before the first Messages request", async () => {
    let auth = {
      type: "oauth" as const,
      refresh: "refresh-token",
      access: "access-token",
      expires: Date.now() + 60 * 60 * 1000,
      accountId: undefined as string | undefined,
    }
    const updates: AuthUpdate[] = []
    const bodies: string[] = []
    let profiles = 0
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname === "/api/oauth/profile") {
          profiles += 1
          return Response.json({ account: { uuid: "account-profile" } })
        }
        bodies.push(await request.text())
        return new Response("{}", { status: 200 })
      },
    })
    const hooks = await ClaudeAuthPlugin(
      pluginInput(async (update) => {
        updates.push(update)
        auth = {
          type: "oauth",
          refresh: update.body.refresh,
          access: update.body.access,
          expires: update.body.expires,
          accountId: update.body.accountId,
        }
      }),
      {
        profileEndpoint: new URL("/api/oauth/profile", server.url).toString(),
        apiEndpoint: new URL("/v1/messages", server.url).toString(),
      },
    )
    const loaded = await hooks.auth!.loader!(async () => auth as never, {} as never)

    await loaded.fetch!("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "X-Session-Id": "session-test" },
      body: JSON.stringify({ model: "claude-sonnet-5" }),
    })
    await loaded.fetch!("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "X-Session-Id": "session-test" },
      body: JSON.stringify({ model: "claude-sonnet-5" }),
    })

    expect(profiles).toBe(1)
    expect(updates).toEqual([
      {
        path: { id: "anthropic" },
        body: {
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires: auth.expires,
          accountId: "account-profile",
        },
      },
    ])
    const first = JSON.parse(bodies[0]).metadata.user_id
    const second = JSON.parse(bodies[1]).metadata.user_id
    expect(JSON.parse(first)).toEqual({
      device_id: expect.stringMatching(/^[0-9a-f]{64}$/),
      account_uuid: "account-profile",
      session_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
    expect(second).toBe(first)
  })

  test("keeps the callback listener open until it is explicitly cancelled", async () => {
    const hooks = await ClaudeAuthPlugin(pluginInput())
    const authorize = await hooks.auth!.methods[0].authorize!({})
    if (!("callback" in authorize) || authorize.method !== "auto") {
      throw new Error("Expected automatic OAuth authorization result")
    }
    const callback = authorize.callback()
    let settled = false
    callback.finally(() => (settled = true)).catch(() => {})

    await Bun.sleep(20)
    expect(settled).toBe(false)

    await hooks.dispose!()
    await expect(callback).rejects.toThrow("Claude OAuth login cancelled")
  })

  test("exchanges a loopback callback and redirects after login succeeds", async () => {
    const requests: string[] = []
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push(url.pathname)
        if (url.pathname === "/v1/oauth/token") {
          return Response.json({
            access_token: "access-initial",
            refresh_token: "refresh-initial",
            expires_in: 3600,
          })
        }
        return Response.json({ account: { uuid: "account-test" } })
      },
    })
    const hooks = await ClaudeAuthPlugin(pluginInput(), {
      tokenEndpoint: new URL("/v1/oauth/token", server.url).toString(),
      profileEndpoint: new URL("/api/oauth/profile", server.url).toString(),
    })
    const authorize = await hooks.auth!.methods[0].authorize!({})
    if (!("callback" in authorize) || authorize.method !== "auto" || !authorize.url) {
      throw new Error("Expected automatic OAuth authorization result")
    }
    const authorizeUrl = new URL(authorize.url)
    const redirectUri = authorizeUrl.searchParams.get("redirect_uri")!
    const state = authorizeUrl.searchParams.get("state")!
    const callback = authorize.callback()
    const browser = fetch(`${redirectUri}?code=authorization-code&state=${encodeURIComponent(state)}`, {
      redirect: "manual",
    })
    const [result, response] = await Promise.all([callback, browser])

    expect(result).toEqual({
      type: "success",
      refresh: "refresh-initial",
      access: "access-initial",
      expires: expect.any(Number),
      accountId: "account-test",
    })
    expect(requests).toEqual(["/v1/oauth/token", "/api/oauth/profile"])
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(SUCCESS_ENDPOINT)
  })

  test("filters OAuth models to the current subscription catalog with zero cost", async () => {
    const hooks = await ClaudeAuthPlugin(pluginInput())
    const provider = {
      models: Object.fromEntries(
        [
          "claude-sonnet-5",
          "claude-opus-4-8",
          "claude-opus-4-8-fast",
          "claude-fable-5",
          "claude-haiku-4-5",
          "claude-haiku-4-5-20251001",
          "claude-api-only",
        ].map((id) => [
          id,
          {
            id,
            api: { id },
            cost: {
              input: 3,
              output: 15,
              cache: { read: 0.3, write: 3.75 },
            },
          },
        ]),
      ),
    }
    provider.models["claude-opus-4-8-fast"].api.id = "claude-opus-4-8"

    const models = await hooks.provider!.models!(provider as never, { auth: { type: "oauth" } } as never)

    expect(Object.keys(models)).toEqual(["claude-sonnet-5", "claude-opus-5", "claude-opus-4-8", "claude-fable-5"])
    expect(models["claude-opus-5"]).toMatchObject({
      id: "claude-opus-5",
      name: "Claude Opus 5",
      family: "claude-opus",
      api: { id: "claude-opus-5" },
      release_date: "2026-07-24",
    })
    expect(models["claude-sonnet-5"].cost).toEqual({
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    })
    const small: { model?: unknown } = {}
    await hooks["experimental.provider.small_model"]!({ provider: { id: "anthropic" } } as never, small as never)
    expect(small.model).toEqual(provider.models["claude-haiku-4-5-20251001"])
    expect(await hooks.provider!.models!(provider as never, { auth: { type: "api" } } as never)).toBe(
      provider.models as never,
    )
  })

  test("uses the captured Claude Code body defaults for subscription requests", async () => {
    const hooks = await ClaudeAuthPlugin(pluginInput())
    const loaded = await hooks.auth!.loader!(
      async () =>
        ({
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires: Date.now() + 60 * 60 * 1000,
          accountId: "account-test",
        }) as never,
      {} as never,
    )
    const output = {
      temperature: undefined,
      topP: undefined,
      topK: undefined,
      maxOutputTokens: 32_000,
      options: {},
    }

    await hooks["chat.params"]!(
      {
        agent: "build",
        model: { providerID: "anthropic" },
        provider: { options: loaded },
      } as never,
      output as never,
    )

    expect(output.maxOutputTokens).toBe(64_000)
    expect(output.options).toEqual({
      thinking: { type: "adaptive" },
      effort: "medium",
    })

    const title = {
      temperature: undefined,
      topP: undefined,
      topK: undefined,
      maxOutputTokens: 64_000,
      options: { effort: "low" } as Record<string, unknown>,
    }
    await hooks["chat.params"]!(
      {
        agent: "title",
        model: { providerID: "anthropic" },
        provider: { options: loaded },
      } as never,
      title as never,
    )
    expect(title.maxOutputTokens).toBe(32_000)
    expect(title.options).toEqual({
      thinking: { type: "disabled" },
    })

    const headers = { headers: {} as Record<string, string> }
    await hooks["chat.headers"]!(
      {
        agent: "title",
        model: { providerID: "anthropic" },
        provider: { options: loaded },
      } as never,
      headers,
    )
    expect(headers.headers).toEqual({
      "x-opencode-claude-request": "title",
    })
  })

  test("leaves non-Messages requests untouched", async () => {
    const url = "https://api.anthropic.com/v1/models?source=opencode"
    const init: RequestInit = {
      method: "POST",
      headers: {
        Authorization: "Basic original",
        "X-Api-Key": "original-key",
        "X-Custom": "original-value",
      },
      body: "original-body",
    }
    let capturedInput: RequestInfo | URL | undefined
    let capturedInit: RequestInit | undefined
    const httpFetch = Object.assign(
      async (input: RequestInfo | URL, requestInit?: RequestInit) => {
        capturedInput = input
        capturedInit = requestInit
        return new Response("untouched")
      },
      { preconnect() {} },
    )
    const hooks = await ClaudeAuthPlugin(pluginInput(), {
      httpFetch,
      deviceID: async () => {
        throw new Error("device ID should not be loaded")
      },
    })
    const loaded = await hooks.auth!.loader!(
      async () =>
        ({
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires: 0,
          accountId: "account-test",
        }) as never,
      {} as never,
    )

    expect(await (await loaded.fetch!(url, init)).text()).toBe("untouched")
    expect(capturedInput).toBe(url)
    expect(capturedInit).toBe(init)
  })

  test("rewrites Messages requests with the captured Claude Code headers", async () => {
    const requests: Array<{
      url: string
      method: string
      body: string
      authorization: string | null
      apiKey: string | null
      version: string | null
      beta: string | null
      browserAccess: string | null
      app: string | null
      sessionID: string | null
      clientRequestID: string | null
      sessionAffinity: string | null
      opencodeSessionID: string | null
      parentSessionID: string | null
      userAgent: string | null
      accept: string | null
      stainlessArch: string | null
      stainlessHelperMethod: string | null
      stainlessLang: string | null
      stainlessOS: string | null
      stainlessPackageVersion: string | null
      stainlessRetryCount: string | null
      stainlessRuntime: string | null
      stainlessRuntimeVersion: string | null
      stainlessTimeout: string | null
    }> = []

    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        requests.push({
          url: request.url,
          method: request.method,
          body: await request.text(),
          authorization: request.headers.get("authorization"),
          apiKey: request.headers.get("x-api-key"),
          version: request.headers.get("anthropic-version"),
          beta: request.headers.get("anthropic-beta"),
          browserAccess: request.headers.get("anthropic-dangerous-direct-browser-access"),
          app: request.headers.get("x-app"),
          sessionID: request.headers.get("x-claude-code-session-id"),
          clientRequestID: request.headers.get("x-client-request-id"),
          sessionAffinity: request.headers.get("x-session-affinity"),
          opencodeSessionID: request.headers.get("x-session-id"),
          parentSessionID: request.headers.get("x-parent-session-id"),
          userAgent: request.headers.get("user-agent"),
          accept: request.headers.get("accept"),
          stainlessArch: request.headers.get("x-stainless-arch"),
          stainlessHelperMethod: request.headers.get("x-stainless-helper-method"),
          stainlessLang: request.headers.get("x-stainless-lang"),
          stainlessOS: request.headers.get("x-stainless-os"),
          stainlessPackageVersion: request.headers.get("x-stainless-package-version"),
          stainlessRetryCount: request.headers.get("x-stainless-retry-count"),
          stainlessRuntime: request.headers.get("x-stainless-runtime"),
          stainlessRuntimeVersion: request.headers.get("x-stainless-runtime-version"),
          stainlessTimeout: request.headers.get("x-stainless-timeout"),
        })
        return new Response("event: message_stop\ndata: {}\n\n", {
          headers: { "Content-Type": "text/event-stream" },
        })
      },
    })

    const hooks = await ClaudeAuthPlugin(pluginInput(), {
      apiEndpoint: new URL("/v1/messages", server.url).toString(),
    })
    const loaded = await hooks.auth!.loader!(
      async () =>
        ({
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires: Date.now() + 60 * 60 * 1000,
          accountId: "account-test",
        }) as never,
      {} as never,
    )
    const response = await loaded.fetch!("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        "X-Api-Key": "api-key-must-be-removed",
        Authorization: "Basic must-be-replaced",
        "Anthropic-Version": "old",
        "X-Session-Affinity": "session-test",
        "X-Session-Id": "session-test",
        "X-Parent-Session-Id": "parent-test",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        messages: [{ role: "user", content: "hello" }],
        stream: true,
        system: [{ type: "text", text: "OpenCode system" }],
        temperature: 0.5,
        top_k: 10,
        top_p: 0.9,
      }),
    })

    expect(await response.text()).toBe("event: message_stop\ndata: {}\n\n")
    expect(requests).toHaveLength(1)
    expect(requests[0]).toEqual({
      url: new URL("/v1/messages?beta=true", server.url).toString(),
      method: "POST",
      body: expect.any(String),
      authorization: "Bearer access-token",
      apiKey: null,
      version: ANTHROPIC_VERSION,
      beta: ANTHROPIC_BETA,
      browserAccess: "true",
      app: "cli",
      sessionID: expect.stringMatching(/^[0-9a-f-]{36}$/),
      clientRequestID: expect.stringMatching(/^[0-9a-f-]{36}$/),
      sessionAffinity: null,
      opencodeSessionID: null,
      parentSessionID: null,
      userAgent: "claude-cli/2.1.220 (external, sdk-cli)",
      accept: "application/json",
      stainlessArch: process.arch,
      stainlessHelperMethod: null,
      stainlessLang: "js",
      stainlessOS:
        process.platform === "darwin"
          ? "MacOS"
          : process.platform === "win32"
            ? "Windows"
            : process.platform === "linux"
              ? "Linux"
              : `Other:${process.platform}`,
      stainlessPackageVersion: "0.94.0",
      stainlessRetryCount: "0",
      stainlessRuntime: "node",
      stainlessRuntimeVersion: "v26.3.0",
      stainlessTimeout: "600",
    })
    const body = JSON.parse(requests[0].body)
    const userID = JSON.parse(body.metadata.user_id)
    expect(Object.keys(body)).toEqual([
      "model",
      "messages",
      "system",
      "tools",
      "metadata",
      "max_tokens",
      "thinking",
      "context_management",
      "output_config",
      "diagnostics",
      "stream",
    ])
    expect(body).toEqual({
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
      max_tokens: 64_000,
      thinking: { type: "adaptive" },
      context_management: {
        edits: [{ type: "clear_thinking_20251015", keep: "all" }],
      },
      output_config: { effort: "medium" },
      diagnostics: {
        previous_message_id: null,
      },
      tools: [],
      metadata: {
        user_id: expect.any(String),
      },
      system: [
        { type: "text", text: CLAUDE_CODE_BILLING },
        { type: "text", text: CLAUDE_AGENT_IDENTITY },
        { type: "text", text: "OpenCode system" },
      ],
    })
    expect(userID).toEqual({
      device_id: expect.stringMatching(/^[0-9a-f]{64}$/),
      account_uuid: "account-test",
      session_id: requests[0].sessionID,
      parent_session_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
  })

  test("uses the captured Claude Code auxiliary envelope for title requests", async () => {
    const requests: Array<{
      beta: string | null
      helperMethod: string | null
      marker: string | null
      body: Record<string, unknown>
    }> = []
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        requests.push({
          beta: request.headers.get("anthropic-beta"),
          helperMethod: request.headers.get("x-stainless-helper-method"),
          marker: request.headers.get("x-opencode-claude-request"),
          body: (await request.json()) as Record<string, unknown>,
        })
        return new Response("{}", { status: 200 })
      },
    })
    const hooks = await ClaudeAuthPlugin(pluginInput(), {
      apiEndpoint: new URL("/v1/messages", server.url).toString(),
    })
    const loaded = await hooks.auth!.loader!(
      async () =>
        ({
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires: Date.now() + 60 * 60 * 1000,
          accountId: "account-test",
        }) as never,
      {} as never,
    )

    await loaded.fetch!("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenCode-Claude-Request": "title",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: "Generate a title" }],
        max_tokens: 64_000,
        output_config: { effort: "low" },
        stream: true,
        system: [{ type: "text", text: "OpenCode title prompt" }],
        temperature: 0.5,
        thinking: { type: "adaptive", display: "omitted" },
        top_k: 10,
        top_p: 0.9,
      }),
    })

    expect(requests).toHaveLength(1)
    expect(requests[0].beta).toBe(ANTHROPIC_AUXILIARY_BETA)
    expect(requests[0].helperMethod).toBeNull()
    expect(requests[0].marker).toBeNull()
    expect(Object.keys(requests[0].body)).toEqual([
      "model",
      "messages",
      "system",
      "tools",
      "metadata",
      "max_tokens",
      "thinking",
      "temperature",
      "output_config",
      "stream",
    ])
    expect(requests[0].body).toEqual({
      model: "claude-haiku-4-5-20251001",
      messages: [{ role: "user", content: "Generate a title" }],
      max_tokens: 32_000,
      stream: true,
      system: [
        { type: "text", text: CLAUDE_CODE_AUXILIARY_BILLING },
        { type: "text", text: CLAUDE_AGENT_IDENTITY },
        { type: "text", text: "OpenCode title prompt" },
      ],
      thinking: { type: "disabled" },
      temperature: 1,
      tools: [],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
      metadata: {
        user_id: expect.any(String),
      },
    })
  })

  for (const rejection of [
    { name: "401", status: 401, body: '{"error":{"message":"unauthorized"}}' },
    { name: "revoked-token 403", status: 403, body: '{"error":{"message":"OAuth token has been revoked"}}' },
  ]) {
    test(`refreshes and retries once after ${rejection.name}`, async () => {
      const now = 1_800_000_000_000
      let auth = {
        type: "oauth" as const,
        refresh: "refresh-old",
        access: "access-rejected",
        expires: now + 60 * 60 * 1000,
        accountId: "account-test",
      }
      const updates: AuthUpdate[] = []
      const apiRequests: Array<{
        authorization: string | null
        clientRequestID: string | null
        sessionID: string | null
        body: string
      }> = []
      let refreshRequests = 0

      using server = Bun.serve({
        port: 0,
        async fetch(request) {
          const url = new URL(request.url)
          if (url.pathname === "/v1/oauth/token") {
            refreshRequests += 1
            return Response.json({
              access_token: "access-new",
              refresh_token: "refresh-new",
              expires_in: 3600,
            })
          }

          apiRequests.push({
            authorization: request.headers.get("authorization"),
            clientRequestID: request.headers.get("x-client-request-id"),
            sessionID: request.headers.get("x-claude-code-session-id"),
            body: await request.text(),
          })
          if (apiRequests.length === 1) {
            return new Response(rejection.body, { status: rejection.status })
          }
          return new Response("{}", { status: 200 })
        },
      })

      const hooks = await ClaudeAuthPlugin(
        pluginInput(async (update) => {
          updates.push(update)
          auth = {
            type: "oauth",
            refresh: update.body.refresh,
            access: update.body.access,
            expires: update.body.expires,
            accountId: update.body.accountId ?? "account-test",
          }
        }),
        {
          tokenEndpoint: new URL("/v1/oauth/token", server.url).toString(),
          apiEndpoint: new URL("/v1/messages", server.url).toString(),
          now: () => now,
        },
      )
      const loaded = await hooks.auth!.loader!(async () => auth as never, {} as never)
      const body = JSON.stringify({ model: "claude-sonnet-5", messages: [{ role: "user", content: "hello" }] })
      const response = await loaded.fetch!("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })

      expect(response.status).toBe(200)
      expect(refreshRequests).toBe(1)
      expect(updates).toEqual([
        {
          path: { id: "anthropic" },
          body: {
            type: "oauth",
            refresh: "refresh-new",
            access: "access-new",
            expires: now + 3600 * 1000,
            accountId: "account-test",
          },
        },
      ])
      expect(apiRequests).toEqual([
        {
          authorization: "Bearer access-rejected",
          clientRequestID: expect.stringMatching(/^[0-9a-f-]{36}$/),
          sessionID: expect.stringMatching(/^[0-9a-f-]{36}$/),
          body: expect.any(String),
        },
        {
          authorization: "Bearer access-new",
          clientRequestID: expect.stringMatching(/^[0-9a-f-]{36}$/),
          sessionID: expect.stringMatching(/^[0-9a-f-]{36}$/),
          body: expect.any(String),
        },
      ])
      expect(apiRequests[0].body).toBe(apiRequests[1].body)
      expect(apiRequests[0].sessionID).toBe(apiRequests[1].sessionID)
      expect(apiRequests[0].clientRequestID).not.toBe(apiRequests[1].clientRequestID)
    })
  }

  test("does not refresh an unrelated 403 response", async () => {
    let requests = 0
    const httpFetch = Object.assign(
      async () => {
        requests += 1
        return new Response('{"error":{"message":"permission denied"}}', { status: 403 })
      },
      { preconnect() {} },
    )
    const hooks = await ClaudeAuthPlugin(pluginInput(), {
      httpFetch,
    })
    const loaded = await hooks.auth!.loader!(
      async () =>
        ({
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires: Date.now() + 60 * 60 * 1000,
          accountId: "account-test",
        }) as never,
      {} as never,
    )

    const response = await loaded.fetch!("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: "{}",
    })

    expect(response.status).toBe(403)
    expect(requests).toBe(1)
  })

  test("refreshes five minutes early, keeps an unrotated refresh token, and deduplicates requests", async () => {
    const now = 1_800_000_000_000
    let auth = {
      type: "oauth" as const,
      refresh: "refresh-old",
      access: "access-expiring",
      expires: now + 4 * 60 * 1000,
      accountId: "account-test",
    }
    const updates: AuthUpdate[] = []
    const apiAuthorizations: Array<string | null> = []
    let refreshRequests = 0
    let releaseRefresh: () => void
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    let signalRefresh: () => void
    const refreshStarted = new Promise<void>((resolve) => {
      signalRefresh = resolve
    })

    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/v1/oauth/token") {
          refreshRequests += 1
          signalRefresh!()
          expect(await request.json()).toEqual({
            grant_type: "refresh_token",
            refresh_token: "refresh-old",
            client_id: CLIENT_ID,
            scope: REFRESH_SCOPES.join(" "),
          })
          await refreshGate
          return Response.json({
            access_token: "access-new",
            expires_in: 3600,
          })
        }

        apiAuthorizations.push(request.headers.get("authorization"))
        return new Response("{}", { status: 200 })
      },
    })

    const hooks = await ClaudeAuthPlugin(
      pluginInput(async (update) => {
        updates.push(update)
        auth = {
          type: "oauth",
          refresh: update.body.refresh,
          access: update.body.access,
          expires: update.body.expires,
          accountId: update.body.accountId ?? "account-test",
        }
      }),
      {
        tokenEndpoint: new URL("/v1/oauth/token", server.url).toString(),
        apiEndpoint: new URL("/v1/messages", server.url).toString(),
        now: () => now,
      },
    )
    const loaded = await hooks.auth!.loader!(async () => auth as never, {} as never)
    const first = loaded.fetch!("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: "{}",
    })
    const second = loaded.fetch!("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: "{}",
    })

    await refreshStarted
    expect(refreshRequests).toBe(1)
    expect(apiAuthorizations).toHaveLength(0)
    releaseRefresh!()
    await Promise.all([first, second])

    expect(refreshRequests).toBe(1)
    expect(updates).toEqual([
      {
        path: { id: "anthropic" },
        body: {
          type: "oauth",
          refresh: "refresh-old",
          access: "access-new",
          expires: now + 3600 * 1000,
          accountId: "account-test",
        },
      },
    ])
    expect(apiAuthorizations).toEqual(["Bearer access-new", "Bearer access-new"])
  })
})

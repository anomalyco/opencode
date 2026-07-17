import { describe, expect, test } from "bun:test"
import {
  CodexAuthPlugin,
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  renderOAuthError,
  type IdTokenClaims,
} from "../../src/plugin/openai/codex"

function createTestJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

describe("plugin.codex", () => {
  test("escapes provider errors in callback HTML", () => {
    const error = `</div><script>alert("xss" & 'more')</script>`
    const html = renderOAuthError(error)

    expect(html).toContain("&lt;/div&gt;&lt;script&gt;alert(&quot;xss&quot; &amp; &#39;more&#39;)&lt;/script&gt;")
    expect(html).not.toContain(error)
  })

  describe("parseJwtClaims", () => {
    test("parses valid JWT with claims", () => {
      const payload = { email: "test@example.com", chatgpt_account_id: "acc-123" }
      const jwt = createTestJwt(payload)
      const claims = parseJwtClaims(jwt)
      expect(claims).toEqual(payload)
    })

    test("returns undefined for JWT with less than 3 parts", () => {
      expect(parseJwtClaims("invalid")).toBeUndefined()
      expect(parseJwtClaims("only.two")).toBeUndefined()
    })

    test("returns undefined for invalid base64", () => {
      expect(parseJwtClaims("a.!!!invalid!!!.b")).toBeUndefined()
    })

    test("returns undefined for invalid JSON payload", () => {
      const header = Buffer.from("{}").toString("base64url")
      const invalidJson = Buffer.from("not json").toString("base64url")
      expect(parseJwtClaims(`${header}.${invalidJson}.sig`)).toBeUndefined()
    })
  })

  describe("extractAccountIdFromClaims", () => {
    test("extracts chatgpt_account_id from root", () => {
      const claims: IdTokenClaims = { chatgpt_account_id: "acc-root" }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts chatgpt_account_id from nested https://api.openai.com/auth", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-nested")
    })

    test("prefers root over nested", () => {
      const claims: IdTokenClaims = {
        chatgpt_account_id: "acc-root",
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts from organizations array as fallback", () => {
      const claims: IdTokenClaims = {
        organizations: [{ id: "org-123" }, { id: "org-456" }],
      }
      expect(extractAccountIdFromClaims(claims)).toBe("org-123")
    })

    test("returns undefined when no accountId found", () => {
      const claims: IdTokenClaims = { email: "test@example.com" }
      expect(extractAccountIdFromClaims(claims)).toBeUndefined()
    })
  })

  describe("extractAccountId", () => {
    test("extracts from id_token first", () => {
      const idToken = createTestJwt({ chatgpt_account_id: "from-id-token" })
      const accessToken = createTestJwt({ chatgpt_account_id: "from-access-token" })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-id-token")
    })

    test("falls back to access_token when id_token has no accountId", () => {
      const idToken = createTestJwt({ email: "test@example.com" })
      const accessToken = createTestJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "from-access" },
      })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-access")
    })

    test("returns undefined when no tokens have accountId", () => {
      const token = createTestJwt({ email: "test@example.com" })
      expect(
        extractAccountId({
          id_token: token,
          access_token: token,
          refresh_token: "rt",
        }),
      ).toBeUndefined()
    })

    test("handles missing id_token", () => {
      const accessToken = createTestJwt({ chatgpt_account_id: "acc-123" })
      expect(
        extractAccountId({
          id_token: "",
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("acc-123")
    })
  })

  test("installs websocket transport only when experimental websockets are enabled", async () => {
    const disabled = await CodexAuthPlugin({} as never)
    const enabled = await CodexAuthPlugin({} as never, { experimentalWebSockets: true })

    const disabledOptions = await disabled.auth!.loader!(
      async () => ({ type: "api", key: "sk-test" }) as never,
      {} as never,
    )
    const enabledOptions = await enabled.auth!.loader!(
      async () => ({ type: "api", key: "sk-test" }) as never,
      {} as never,
    )

    expect(disabledOptions.fetch).toBeUndefined()
    expect(enabledOptions.fetch).toBeFunction()
    await enabled.dispose?.()
  })

  test("OAuth loader disables generic timeouts and exposes injectable transport defaults", async () => {
    const hooks = await CodexAuthPlugin({} as never, {
      httpHeaderTimeout: 17,
      httpChunkTimeout: 19,
      websocketConnectTimeout: 23,
      websocketIdleTimeout: 29,
    })
    const options = await hooks.auth!.loader!(async () => ({ type: "oauth", access: "access", refresh: "refresh", expires: Date.now() + 60_000 }) as never, {} as never)
    expect(options.headerTimeout).toBe(false)
    expect(options.chunkTimeout).toBe(false)
    await hooks.dispose?.()
  })


  test("preserves omitted and empty refresh tokens but stores rotated tokens", async () => {
    for (const refresh_token of [undefined, "", "refresh-rotated"] as const) {
      let auth = { type: "oauth" as const, access: "", refresh: "refresh-old", expires: 0 }
      let update: { refresh: string } | undefined
      using server = Bun.serve({
        port: 0,
        async fetch(request) {
          if (new URL(request.url).pathname === "/oauth/token") return Response.json({ access_token: "access-new", ...(refresh_token === undefined ? {} : { refresh_token }), expires_in: 3600 })
          return new Response("ok")
        },
      })
      const hooks = await CodexAuthPlugin({ client: { auth: { async set(input: { body: { refresh: string; access: string; expires: number } }) { update = input.body; auth = { ...auth, ...input.body } } } } as never } as never, { issuer: server.url.origin })
      const loaded = await hooks.auth!.loader!(async () => auth as never, {} as never)
      await loaded.fetch!(new URL("/responses", server.url))
      expect(update?.refresh).toBe(refresh_token || "refresh-old")
      await hooks.dispose?.()
    }
  })

  test("preserves whitespace-only refresh tokens and trims rotated refresh tokens", async () => {
    for (const refresh_token of [undefined, "", "   ", "  rotated  "] as const) {
      let auth = { type: "oauth" as const, access: "", refresh: "refresh-old", expires: 0 }
      let update: { refresh: string } | undefined
      using server = Bun.serve({ port: 0, async fetch(request) {
        if (new URL(request.url).pathname === "/oauth/token") return Response.json({ access_token: "access-new", ...(refresh_token === undefined ? {} : { refresh_token }), expires_in: 3600 })
        return new Response("ok")
      } })
      const hooks = await CodexAuthPlugin({ client: { auth: { async set(input: { body: { refresh: string; access: string; expires: number } }) { update = input.body; auth = { ...auth, ...input.body } } } } as never } as never, { issuer: server.url.origin })
      const loaded = await hooks.auth!.loader!(async () => auth as never, {} as never)
      await loaded.fetch!(new URL("/responses", server.url))
      expect(update?.refresh).toBe(refresh_token?.trim() || "refresh-old")
      await hooks.dispose?.()
    }
  })

  test("passes production and injectable WebSocket timeouts through the plugin pool factory", async () => {
    const calls: Array<{ connectTimeout?: number; idleTimeout?: number }> = []
    const poolFactory = (input: { connectTimeout?: number; idleTimeout?: number }) => {
      calls.push(input)
      const fetch = Object.assign(async () => new Response("ok"), { close() {}, remove() {} })
      return fetch
    }
    const defaultHooks = await CodexAuthPlugin({} as never, { experimentalWebSockets: true, websocketPoolFactory: poolFactory as never })
    const overrideHooks = await CodexAuthPlugin({} as never, { experimentalWebSockets: true, websocketConnectTimeout: 23, websocketIdleTimeout: 29, websocketPoolFactory: poolFactory as never })
    await defaultHooks.auth!.loader!(async () => ({ type: "api", key: "key" }) as never, {} as never)
    await overrideHooks.auth!.loader!(async () => ({ type: "api", key: "key" }) as never, {} as never)
    expect(calls.map((call) => ({ connectTimeout: call.connectTimeout, idleTimeout: call.idleTimeout }))).toEqual([{ connectTimeout: 60_000, idleTimeout: 360_000 }, { connectTimeout: 23, idleTimeout: 29 }])
    await defaultHooks.dispose?.()
    await overrideHooks.dispose?.()
  })

  test("does not mutate caller headers and replays POST bytes across status retries", async () => {
    const callerHeaders = new Headers({ authorization: "caller", "ChatGPT-Account-Id": "caller-account", "x-test": "yes" })
    const bodies: string[] = []
    let calls = 0
    using server = Bun.serve({ port: 0, async fetch(request) { bodies.push(await request.text()); calls++; return new Response("retry", { status: calls === 1 ? 502 : 200, headers: { "content-type": "text/event-stream" } }) } })
    const auth = { type: "oauth" as const, access: "trusted", refresh: "refresh", expires: Date.now() + 60_000, accountId: "trusted-account" }
    const hooks = await CodexAuthPlugin({} as never, { codexApiEndpoint: new URL("/responses", server.url).toString() })
    const loaded = await hooks.auth!.loader!(async () => auth as never, {} as never)
    const request = new Request("https://api.openai.com/v1/responses", { method: "POST", headers: callerHeaders, body: "payload" })
    await loaded.fetch!(request)
    expect(callerHeaders.get("authorization")).toBe("caller")
    expect(callerHeaders.get("ChatGPT-Account-Id")).toBe("caller-account")
    expect(bodies).toEqual(["payload", "payload"])
    await hooks.dispose?.()
  })

  test("uses direct fetch for unrelated OAuth URLs", async () => {
    const hooks = await CodexAuthPlugin({} as never)
    const loaded = await hooks.auth!.loader!(async () => ({ type: "oauth", access: "access", refresh: "refresh", expires: Date.now() + 60_000 }) as never, {} as never)
    const response = await loaded.fetch!("data:application/json,%7B%22ok%22%3Atrue%7D")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  test("rejects refresh responses with an empty access token", async () => {
    using server = Bun.serve({ port: 0, fetch: async () => Response.json({ access_token: "   ", refresh_token: "refresh" }) })
    const hooks = await CodexAuthPlugin({} as never, { issuer: server.url.origin, codexApiEndpoint: new URL("/v1/responses", server.url).toString() })
    const loaded = await hooks.auth!.loader!(async () => ({ type: "oauth", access: "", refresh: "refresh", expires: 0 }) as never, {} as never)
    const result = loaded.fetch!(new URL("/v1/responses", server.url)).catch((error: unknown) => error)
    expect(await result).toBeInstanceOf(Error)
  })

  test("recovers a wrapped WebSocket 401 once and replays SSE bytes", async () => {
    const sent: Array<{ body: string; authorization: string | null; account: string | null }> = []
    let refreshes = 0
    let auth = { type: "oauth" as const, access: "old", refresh: "refresh", expires: Date.now() + 60_000, accountId: "old-account" }
    const sse = 'data: {"type":"response.created"}\n\n'
    const factory = () => {
      let calls = 0
      return Object.assign(async (_url: URL, init?: RequestInit) => {
        calls++
        sent.push({ body: String(init?.body ?? ""), authorization: new Headers(init?.headers).get("authorization"), account: new Headers(init?.headers).get("chatgpt-account-id") })
        return calls === 1 ? new Response("unauthorized", { status: 401 }) : new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })
      }, { close() {}, remove() {} })
    }
    using server = Bun.serve({ port: 0, fetch: async (request) => { refreshes++; await request.text(); return Response.json({ access_token: "new", refresh_token: "refresh", expires_in: 3600 }) } })
    const hooks = await CodexAuthPlugin({ client: { auth: { async set(input: { body: typeof auth }) { auth = { ...auth, ...input.body } } } } as never } as never, { experimentalWebSockets: true, websocketPoolFactory: factory as never, issuer: server.url.origin })
    const loaded = await hooks.auth!.loader!(async () => auth as never, {} as never)
    const response = await loaded.fetch!("https://api.openai.com/v1/responses", { method: "POST", body: "body" })
    expect(await response.text()).toBe(sse); expect(refreshes).toBe(1); expect(sent).toHaveLength(2); expect(sent[1]).toEqual({ body: "body", authorization: "Bearer new", account: "old-account" })
    await hooks.dispose?.()
  })

  test("returns a second WebSocket 401 unchanged and does not retry again", async () => {
    let sends = 0; let refreshes = 0
    let auth = { type: "oauth" as const, access: "old", refresh: "refresh", expires: Date.now() + 60_000 }
    const factory = () => Object.assign(async () => { sends++; return new Response("second", { status: 401, headers: { "x-sentinel": "yes" } }) }, { close() {}, remove() {} })
    using server = Bun.serve({ port: 0, fetch: async () => { refreshes++; return Response.json({ access_token: "new", refresh_token: "refresh" }) } })
    const hooks = await CodexAuthPlugin({ client: { auth: { async set(input: { body: typeof auth }) { auth = { ...auth, ...input.body } } } } as never } as never, { experimentalWebSockets: true, websocketPoolFactory: factory as never, issuer: server.url.origin })
    const loaded = await hooks.auth!.loader!(async () => auth as never, {} as never); const response = await loaded.fetch!("https://api.openai.com/v1/responses")
    expect(response.status).toBe(401); expect(response.headers.get("x-sentinel")).toBe("yes"); expect(await response.text()).toBe("second"); expect(sends).toBe(2); expect(refreshes).toBe(1)
    await hooks.dispose?.()
  })

  test("WebSocket pool receives reliable OAuth HTTP fallback transport", async () => {
    let httpFetch: typeof fetch | undefined
    const optionsSeen: { headerTimeout?: number; chunkTimeout?: number }[] = []
    const transport = async (input: RequestInfo | URL, init: RequestInit | undefined, options: { headerTimeout?: number; chunkTimeout?: number }) => {
      void input; void init; optionsSeen.push(options)
      return new Response('data: {"type":"response.created"}\n\n', { headers: { "content-type": "text/event-stream" } })
    }
    const factory = (options: { httpFetch: typeof fetch }) => { httpFetch = options.httpFetch; return Object.assign(async () => new Response('data: {"type":"response.created"}\n\n', { headers: { "content-type": "text/event-stream" } }), { close() {}, remove() {} }) }
    const hooks = await CodexAuthPlugin({} as never, { experimentalWebSockets: true, websocketPoolFactory: factory as never, httpHeaderTimeout: 12, httpChunkTimeout: 13, codexHTTPTransport: transport } as never)
    await hooks.auth!.loader!(async () => ({ type: "oauth", access: "access", refresh: "refresh", expires: Date.now() + 60_000 }) as never, {} as never)
    expect(httpFetch).toBeFunction()
    const response = await httpFetch!("https://chatgpt.test/responses", { method: "POST", body: "body" })
    expect(response).toBeInstanceOf(Response); expect(await response.text()).toContain("response.created"); expect(optionsSeen).toEqual([{ headerTimeout: 12, chunkTimeout: 13 }])
    await hooks.dispose?.()

    let defaultFetch: typeof fetch | undefined
    const defaultHooks = await CodexAuthPlugin({} as never, { experimentalWebSockets: true, websocketPoolFactory: (options: { httpFetch: typeof fetch }) => { defaultFetch = options.httpFetch; return Object.assign(async () => new Response(), { close() {}, remove() {} }) }, codexHTTPTransport: transport } as never)
    await defaultHooks.auth!.loader!(async () => ({ type: "oauth", access: "access", refresh: "refresh", expires: Date.now() + 60_000 }) as never, {} as never)
    await defaultFetch!("https://chatgpt.test/responses")
    expect(optionsSeen.at(-1)).toEqual({ headerTimeout: 60_000, chunkTimeout: 360_000 })
    await defaultHooks.dispose?.()
  })

  test("stream request bodies replay across 401 and oversized bodies fail before send", async () => {
    let calls = 0
    const factory = () => Object.assign(async () => { calls++; return new Response('data: {"type":"response.created"}\n\n', { headers: { "content-type": "text/event-stream" } }) }, { close() {}, remove() {} })
    const hooks = await CodexAuthPlugin({} as never, { experimentalWebSockets: true, websocketPoolFactory: factory as never })
    const loaded = await hooks.auth!.loader!(async () => ({ type: "oauth", access: "access", refresh: "refresh", expires: Date.now() + 60_000 }) as never, {} as never)
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("body")); controller.close() } })
    const response = await loaded.fetch!("https://api.openai.com/v1/responses", { method: "POST", body: stream }); await response.arrayBuffer(); expect(calls).toBe(1)
    await expect(loaded.fetch!("https://api.openai.com/v1/responses", { method: "POST", body: "x".repeat(17 * 1024 * 1024) })).rejects.toThrow(); expect(calls).toBe(1)
    await hooks.dispose?.()
  })

  test("Request signal is propagated when init signal is absent", async () => {
    const controller = new AbortController(); let seen: AbortSignal | undefined
    const factory = () => Object.assign(async (_url: URL, init?: RequestInit) => { seen = init?.signal ?? undefined; return new Promise<Response>(() => {}) }, { close() {}, remove() {} })
    const hooks = await CodexAuthPlugin({} as never, { experimentalWebSockets: true, websocketPoolFactory: factory as never })
    const loaded = await hooks.auth!.loader!(async () => ({ type: "oauth", access: "access", refresh: "refresh", expires: Date.now() + 60_000 }) as never, {} as never)
    const promise = loaded.fetch!(new Request("https://api.openai.com/v1/responses", { signal: controller.signal })); await waitFor(() => seen !== undefined); controller.abort(); expect(seen).toBeDefined(); await hooks.dispose?.(); void promise.catch(() => {})
  })

  test("shares blocked reactive refresh while an aborted waiter does not reissue", async () => {
    let refreshRequests = 0
    let releaseRefresh!: () => void
    const refreshReady = new Promise<void>((resolve) => { releaseRefresh = resolve })
    let auth = { type: "oauth" as const, access: "old", refresh: "refresh", expires: Date.now() + 60_000, accountId: "account" }
    let apiCalls = 0
    using server = Bun.serve({ port: 0, async fetch(request) {
      if (new URL(request.url).pathname === "/oauth/token") { refreshRequests++; await refreshReady; return Response.json({ access_token: "new", refresh_token: "refresh", expires_in: 3600 }) }
      apiCalls++; await request.text(); return new Response(apiCalls <= 2 ? "unauthorized" : 'data: {"type":"response.created"}\n\n', { status: apiCalls <= 2 ? 401 : 200, headers: apiCalls > 2 ? { "content-type": "text/event-stream" } : undefined })
    } })
    const hooks = await CodexAuthPlugin({ client: { auth: { async set(input: { body: typeof auth }) { auth = { ...auth, ...input.body } } } } as never } as never, { issuer: server.url.origin, codexApiEndpoint: new URL("/responses", server.url).toString() })
    const loaded = await hooks.auth!.loader!(async () => auth as never, {} as never)
    const a = new AbortController(); const first = loaded.fetch!("https://api.openai.com/v1/responses", { method: "POST", signal: a.signal, body: "a" }); const second = loaded.fetch!("https://api.openai.com/v1/responses", { method: "POST", body: "b" })
    await waitFor(() => refreshRequests === 1); a.abort(new Error("caller aborted")); await expect(first).rejects.toThrow("caller aborted"); releaseRefresh(); const response = await second; expect(await response.text()).toContain("response.created"); expect(refreshRequests).toBe(1); expect(apiCalls).toBe(3)
    await hooks.dispose?.()
  })

  test("rejects an oversized stream before consuming its remainder", async () => {
    let pulls = 0; let transportCalls = 0
    const hooks = await CodexAuthPlugin({} as never, { codexHTTPTransport: async () => { transportCalls++; return new Response('data: {"type":"response.created"}\n\n', { headers: { "content-type": "text/event-stream" } }) } } as never)
    const loaded = await hooks.auth!.loader!(async () => ({ type: "oauth", access: "access", refresh: "refresh", expires: Date.now() + 60_000 }) as never, {} as never)
    const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(17 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); controller.close() } })
    await expect(loaded.fetch!("https://api.openai.com/v1/responses", { method: "POST", body: stream })).rejects.toThrow(/16.*bytes/); expect(pulls).toBe(1); expect(transportCalls).toBe(0); await hooks.dispose?.()
  })

  test("refreshes once after a 401 and reissues the identical request", async () => {
    let auth = { type: "oauth" as const, access: "access-old", refresh: "refresh-old", expires: Date.now() + 60_000, accountId: "account-old" }
    let refreshes = 0
    const requests: Array<{ authorization: string | null; account: string | null; body: string }> = []
    using server = Bun.serve({ port: 0, async fetch(request) {
      if (new URL(request.url).pathname === "/oauth/token") { refreshes++; return Response.json({ access_token: "access-new", refresh_token: "refresh-new", expires_in: 3600 }) }
      requests.push({ authorization: request.headers.get("authorization"), account: request.headers.get("chatgpt-account-id"), body: await request.text() })
      return new Response("response", { status: requests.length === 1 ? 401 : 200 })
    } })
    const hooks = await CodexAuthPlugin({ client: { auth: { async set(input: { body: typeof auth }) { auth = { ...auth, ...input.body } } } } as never } as never, { issuer: server.url.origin, codexApiEndpoint: new URL("/responses", server.url).toString() })
    const loaded = await hooks.auth!.loader!(async () => auth as never, {} as never)
    const body = "request-body"
    const response = await loaded.fetch!("https://api.openai.com/v1/responses", { method: "POST", body })
    expect(response.status).toBe(200); expect(refreshes).toBe(1); expect(requests.map((request) => request.body)).toEqual([body, body]); expect(requests[1]).toEqual({ authorization: "Bearer access-new", account: "account-old", body })
    await hooks.dispose?.()
  })

  test("shares one refresh for concurrent 401 requests and stops after the second 401", async () => {
    for (const finalStatus of [200, 401] as const) {
      let auth = { type: "oauth" as const, access: "access-old", refresh: "refresh-old", expires: Date.now() + 60_000, accountId: "account" }
      let refreshes = 0; let requests = 0
      using server = Bun.serve({ port: 0, async fetch(request) {
        if (new URL(request.url).pathname === "/oauth/token") { refreshes++; return Response.json({ access_token: "access-new", refresh_token: "refresh-new", expires_in: 3600 }) }
        await request.text(); requests++; return new Response("body", { status: requests <= 2 ? 401 : finalStatus })
      } })
      const hooks = await CodexAuthPlugin({ client: { auth: { async set(input: { body: typeof auth }) { auth = { ...auth, ...input.body } } } } as never } as never, { issuer: server.url.origin, codexApiEndpoint: new URL("/responses", server.url).toString() })
      const loaded = await hooks.auth!.loader!(async () => auth as never, {} as never)
      const responses = await Promise.all([loaded.fetch!("https://api.openai.com/v1/responses", { method: "POST", body: "a" }), loaded.fetch!("https://api.openai.com/v1/responses", { method: "POST", body: "b" })])
      expect(refreshes).toBe(1); expect(requests).toBe(finalStatus === 401 ? 4 : 4); expect(responses.every((response) => response.status === finalStatus)).toBe(true)
      await hooks.dispose?.()
    }
  })

  test("does not refresh 403 or 429 responses", async () => {
    for (const status of [403, 429]) {
      let refreshes = 0
      using server = Bun.serve({ port: 0, async fetch(request) { if (new URL(request.url).pathname === "/oauth/token") { refreshes++; return Response.json({ access_token: "new", refresh_token: "new" }) }; await request.text(); return new Response(`body-${status}`, { status, headers: { "x-sentinel": "yes" } }) } })
      const auth = { type: "oauth" as const, access: "access", refresh: "refresh", expires: Date.now() + 60_000 }
      const hooks = await CodexAuthPlugin({} as never, { codexApiEndpoint: new URL("/responses", server.url).toString(), issuer: server.url.origin })
      const loaded = await hooks.auth!.loader!(async () => auth as never, {} as never)
      const response = await loaded.fetch!("https://api.openai.com/v1/responses")
      expect(response.status).toBe(status); expect(response.headers.get("x-sentinel")).toBe("yes"); expect(await response.text()).toBe(`body-${status}`); expect(refreshes).toBe(0)
      await hooks.dispose?.()
    }
  })

  test("abort after the first 401 prevents the refreshed reissue", async () => {
    const controller = new AbortController()
    let calls = 0
    const auth = { type: "oauth" as const, access: "access", refresh: "refresh", expires: Date.now() + 60_000 }
    using server = Bun.serve({ port: 0, async fetch(request) {
      calls++
      if (new URL(request.url).pathname === "/oauth/token") return Response.json({ access_token: "new", refresh_token: "new", expires_in: 3600 })
      await request.text()
      controller.abort(new Error("cancel after 401"))
      return new Response("unauthorized", { status: 401 })
    } })
    const hooks = await CodexAuthPlugin({} as never, { codexApiEndpoint: new URL("/responses", server.url).toString(), issuer: server.url.origin })
    const loaded = await hooks.auth!.loader!(async () => auth as never, {} as never)
    await expect(loaded.fetch!("https://api.openai.com/v1/responses", { method: "POST", signal: controller.signal, body: "body" })).rejects.toThrow("cancel after 401")
    expect(calls).toBe(1)
    await hooks.dispose?.()
  })

  test("filters unsupported modes and uses Codex context limits for OAuth GPT models", async () => {
    const hooks = await CodexAuthPlugin({} as never)
    const limit = { context: 1_050_000, input: 922_000, output: 128_000 }
    const provider = {
      models: {
        ...Object.fromEntries(
          ["gpt-5.4", "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.7-pro"].map((id) => [
            id,
            { id, api: { id }, limit, cost: {}, options: {} },
          ]),
        ),
        "gpt-5.4-pro": {
          id: "gpt-5.4-pro",
          api: { id: "gpt-5.4" },
          limit,
          cost: {},
          options: { reasoningMode: "pro" },
        },
        "gpt-5.6-sol-high": {
          id: "gpt-5.6-sol-high",
          api: { id: "gpt-5.6-sol" },
          limit,
          cost: {},
          options: { reasoningEffort: "high" },
        },
      },
    }

    const models = await hooks.provider!.models!(provider as never, { auth: { type: "oauth" } } as never)

    expect(models["gpt-5.4"]?.limit).toEqual(limit)
    expect(models["gpt-5.5"]?.limit).toEqual({ context: 400_000, input: 272_000, output: 128_000 })
    expect(models["gpt-5.6-sol"]?.limit).toEqual({ context: 500_000, input: 372_000, output: 128_000 })
    expect(models["gpt-5.6-terra"]?.limit).toEqual({ context: 500_000, input: 372_000, output: 128_000 })
    expect(models["gpt-5.6-luna"]?.limit).toEqual({ context: 500_000, input: 372_000, output: 128_000 })
    expect(models["gpt-5.4-pro"]).toBeUndefined()
    expect(models["gpt-5.7-pro"]).toBeDefined()
    expect(models["gpt-5.6-sol-high"]).toBeDefined()
    expect(await hooks.provider!.models!(provider as never, { auth: { type: "api" } } as never)).toBe(
      provider.models as never,
    )
  })

  test("deduplicates concurrent Codex token refreshes", async () => {
    let auth = {
      type: "oauth" as const,
      refresh: "refresh-old",
      access: "",
      expires: 0,
    }
    const authUpdates: Array<{
      body: { refresh: string; access: string; expires: number; accountId?: string }
    }> = []
    let resolveRefresh: (() => void) | undefined
    const refreshReady = new Promise<void>((resolve) => {
      resolveRefresh = resolve
    })
    let refreshRequests = 0
    const apiRequests: { authorization: string | null; accountId: string | null }[] = []

    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/oauth/token") {
          expect(await request.text()).toContain("refresh_token=refresh-old")
          refreshRequests += 1
          await refreshReady
          return Response.json({
            id_token: createTestJwt({ chatgpt_account_id: "acc-123" }),
            access_token: "access-new",
            refresh_token: "refresh-new",
            expires_in: 3600,
          })
        }

        if (url.pathname === "/backend-api/codex/responses") {
          apiRequests.push({
            authorization: request.headers.get("authorization"),
            accountId: request.headers.get("ChatGPT-Account-Id"),
          })
          return new Response("{}", { status: 200 })
        }

        return new Response("unexpected request", { status: 500 })
      },
    })

    const hooks = await CodexAuthPlugin(
      {
        client: {
          auth: {
            async set(input: { body: { refresh: string; access: string; expires: number; accountId?: string } }) {
              authUpdates.push(input)
              auth = {
                type: "oauth",
                refresh: input.body.refresh,
                access: input.body.access,
                expires: input.body.expires,
                ...(input.body.accountId && { accountId: input.body.accountId }),
              }
            },
          },
        } as never,
        project: {} as never,
        directory: "",
        worktree: "",
        experimental_workspace: {
          register() {},
        },
        serverUrl: new URL("https://example.com"),
        $: {} as never,
      },
      {
        issuer: server.url.origin,
        codexApiEndpoint: new URL("/backend-api/codex/responses", server.url).toString(),
      },
    )
    const loaded = await hooks.auth!.loader!(async () => auth as never, {} as never)

    const first = loaded.fetch!("https://api.openai.com/v1/responses")
    const second = loaded.fetch!("https://api.openai.com/v1/responses")

    await waitFor(() => refreshRequests === 1)
    expect(apiRequests).toHaveLength(0)

    resolveRefresh!()
    await Promise.all([first, second])

    expect(refreshRequests).toBe(1)
    expect(authUpdates).toHaveLength(1)
    expect(authUpdates[0]?.body.refresh).toBe("refresh-new")
    expect(authUpdates[0]?.body.access).toBe("access-new")
    expect(authUpdates[0]?.body.accountId).toBe("acc-123")
    expect(apiRequests).toEqual([
      { authorization: "Bearer access-new", accountId: "acc-123" },
      { authorization: "Bearer access-new", accountId: "acc-123" },
    ])
  })
})

async function waitFor(predicate: () => boolean) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 1_000) throw new Error("timed out waiting for condition")
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

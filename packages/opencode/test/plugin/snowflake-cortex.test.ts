import { describe, expect, test } from "bun:test"
import { OAUTH_DUMMY_KEY } from "../../src/auth"
import { oauthScope, SnowflakeCortexAuthPlugin } from "../../src/plugin/snowflake-cortex"

function makeInput() {
  let auth: any = {
    type: "oauth",
    access: "access-old",
    refresh: "refresh-old",
    expires: Date.now() + 3600_000,
    accountId: "myorg-myaccount",
  }
  const setCalls: Array<Record<string, unknown>> = []

  return {
    getAuth: async () => auth,
    setAuth: (next: any) => {
      auth = next
    },
    input: {
      client: {
        auth: {
          set: async (request: any) => {
            setCalls.push(request)
            auth = request.body
          },
        },
      },
    } as any,
    setCalls,
  }
}

describe("plugin.snowflake-cortex", () => {
  test("oauthScope uses Snowflake-compatible scope values", () => {
    expect(oauthScope(undefined)).toBe("refresh_token")
    expect(oauthScope("PUBLIC")).toBe("refresh_token session:role:PUBLIC")
    expect(oauthScope("AUTH SNOWFLAKE")).toBe("refresh_token session:role-encoded:AUTH%20SNOWFLAKE")
  })

  test("loader returns empty options when auth is not oauth", async () => {
    const hooks = await SnowflakeCortexAuthPlugin({} as any)
    const options = await hooks.auth!.loader!(async () => ({ type: "api", key: "token" }) as any, {} as any)
    expect(options).toEqual({})
  })

  test("loader injects bearer header and preserves custom headers", async () => {
    const { input, getAuth, setAuth } = makeInput()
    setAuth({
      type: "oauth",
      access: "access-live",
      refresh: "refresh-live",
      expires: Date.now() + 60 * 60 * 1000,
      accountId: "myorg-myaccount",
    })
    const hooks = await SnowflakeCortexAuthPlugin(input)
    const options = await hooks.auth!.loader!(getAuth as any, {} as any)
    expect(options.apiKey).toBe(OAUTH_DUMMY_KEY)

    const originalFetch = globalThis.fetch
    const captured: Headers[] = []
    globalThis.fetch = (async (_request, init) => {
      captured.push(new Headers(init?.headers))
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    }) as typeof fetch

    try {
      await options.fetch("https://example.test/v1/chat", {
        headers: { Authorization: `Bearer ${OAUTH_DUMMY_KEY}`, "x-keep": "yes" },
      })
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(captured).toHaveLength(1)
    expect(captured[0].get("authorization")).toBe("Bearer access-live")
    expect(captured[0].get("x-keep")).toBe("yes")
    expect(captured[0].get("user-agent")).toMatch(/^opencode\//)
  })

  test("loader refreshes expired token with single-flight and persists refreshed oauth", async () => {
    const { input, getAuth, setCalls } = makeInput()
    let refreshCalls = 0
    const apiAuthHeaders: string[] = []

    // Must mock fetch before calling loader because startup refresh triggers for expires: 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (request, init) => {
      const url =
        typeof request === "string" ? request : request instanceof URL ? request.toString() : String(request.url)

      if (url.includes("/oauth/token-request")) {
        refreshCalls += 1
        const body = new URLSearchParams(String(init?.body ?? ""))
        expect(body.get("grant_type")).toBe("refresh_token")
        expect(body.get("refresh_token")).toBe("refresh-old")
        expect(new Headers(init?.headers).get("authorization")).toMatch(/^Basic /)
        await new Promise((resolve) => setTimeout(resolve, 20))
        return Response.json({ access_token: "access-new", refresh_token: "refresh-new", expires_in: 3600 })
      }

      apiAuthHeaders.push(new Headers(init?.headers).get("authorization") || "")
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    }) as typeof fetch

    try {
      const hooks = await SnowflakeCortexAuthPlugin(input)
      const options = await hooks.auth!.loader!(
        async () => ({
          type: "oauth",
          access: "access-expired",
          refresh: "refresh-old",
          expires: 0,
          accountId: "myorg-myaccount",
        }) as any,
        {} as any,
      )

      await Promise.all([
        options.fetch("https://example.test/v1/chat", { headers: {} }),
        options.fetch("https://example.test/v1/chat", { headers: {} }),
      ])
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(refreshCalls).toBe(1)
    expect(apiAuthHeaders).toEqual(["Bearer access-new", "Bearer access-new"])
    expect(setCalls).toHaveLength(1)
    expect((setCalls[0] as any).body).toMatchObject({
      type: "oauth",
      access: "access-new",
      refresh: "refresh-new",
      accountId: "myorg-myaccount",
    })
  })

  test("loader retries once after 401 by refreshing token", async () => {
    const { input, getAuth, setCalls } = makeInput()
    const hooks = await SnowflakeCortexAuthPlugin(input)
    const options = await hooks.auth!.loader!(
      async () => ({
        type: "oauth",
        access: "access-stale",
        refresh: "refresh-old",
        expires: Date.now() + 60 * 60 * 1000,
        accountId: "myorg-myaccount",
      }) as any,
      {} as any,
    )

    let apiCalls = 0
    const seenAuth: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (request, init) => {
      const url =
        typeof request === "string" ? request : request instanceof URL ? request.toString() : String(request.url)

      if (url.includes("/oauth/token-request")) {
        return Response.json({ access_token: "access-fresh", refresh_token: "refresh-fresh", expires_in: 3600 })
      }

      apiCalls += 1
      seenAuth.push(new Headers(init?.headers).get("authorization") || "")
      if (apiCalls === 1) return new Response("unauthorized", { status: 401 })
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    }) as typeof fetch

    try {
      const response = await options.fetch("https://example.test/v1/chat", { headers: {} })
      expect(response.status).toBe(200)
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(apiCalls).toBe(2)
    expect(seenAuth).toEqual(["Bearer access-stale", "Bearer access-fresh"])
    expect(setCalls).toHaveLength(1)
    expect((setCalls[0] as any).body).toMatchObject({
      type: "oauth",
      access: "access-fresh",
      refresh: "refresh-fresh",
      accountId: "myorg-myaccount",
    })
  })

  test("loader converts max_tokens to max_completion_tokens in request body", async () => {
    const { input, getAuth } = makeInput()
    const hooks = await SnowflakeCortexAuthPlugin(input)
    const options = await hooks.auth!.loader!(getAuth as any, {} as any)

    let sentBody: string | undefined
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (request, init) => {
      sentBody = typeof init?.body === "string" ? init.body : undefined
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    }) as typeof fetch

    try {
      await options.fetch("https://example.test/v1/chat", {
        method: "POST",
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 4096, messages: [] }),
      })
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(sentBody).toBeDefined()
    const parsed = JSON.parse(sentBody!)
    expect(parsed.max_completion_tokens).toBe(4096)
    expect(parsed.max_tokens).toBeUndefined()
    expect(parsed.model).toBe("claude-sonnet-4-5")
  })

  test("loader maps 400 'conversation complete' to 200 stop", async () => {
    const { input, getAuth } = makeInput()
    const hooks = await SnowflakeCortexAuthPlugin(input)
    const options = await hooks.auth!.loader!(getAuth as any, {} as any)

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ message: "Conversation complete" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof fetch

    try {
      const response = await options.fetch("https://example.test/v1/chat", {
        method: "POST",
        body: JSON.stringify({ model: "test", messages: [] }),
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.choices[0].finish_reason).toBe("stop")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("loader fixes empty role in SSE stream", async () => {
    const { input, getAuth } = makeInput()
    const hooks = await SnowflakeCortexAuthPlugin(input)
    const options = await hooks.auth!.loader!(getAuth as any, {} as any)

    const originalFetch = globalThis.fetch
    const sseChunk = `data: {"choices":[{"delta":{"role":"","content":"hello"}}]}\n\n`
    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(new TextEncoder().encode(sseChunk))
          ctrl.close()
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })
    }) as unknown as typeof fetch

    try {
      const response = await options.fetch("https://example.test/v1/chat", {
        method: "POST",
        body: JSON.stringify({ model: "test", messages: [], stream: true }),
      })
      expect(response.status).toBe(200)
      const reader = response.body!.getReader()
      const { value } = await reader.read()
      const text = new TextDecoder().decode(value)
      expect(text).not.toContain('"role":""')
      expect(text).toContain('"role":"assistant"')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

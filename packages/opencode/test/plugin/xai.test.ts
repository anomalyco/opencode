import { describe, expect, test } from "bun:test"
import { accessTokenIsExpiring, buildAuthorizeUrl, escapeHtml, pollDeviceCodeToken, requestDeviceCode, XaiAuthPlugin } from "../../src/plugin/xai"
import { OAUTH_DUMMY_KEY } from "../../src/auth"

function makeJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

function makeInput(opts?: { failSet?: boolean }) {
  const setCalls: Array<Record<string, unknown>> = []
  return {
    input: {
      client: {
        auth: {
          set: async (req: Record<string, unknown>) => {
            setCalls.push(req)
            if (opts?.failSet) throw new Error("auth.set boom")
          },
        },
      },
    } as any,
    setCalls,
  }
}

function makeServer(handler: (request: Request, url: URL) => Response | Promise<Response>) {
  return Bun.serve({
    port: 0,
    fetch: (request) => handler(request, new URL(request.url)),
  })
}

function serverOptions(server: ReturnType<typeof Bun.serve>) {
  return {
    authorizeUrl: new URL("/oauth2/authorize", server.url).toString(),
    tokenUrl: new URL("/oauth2/token", server.url).toString(),
    deviceAuthorizationUrl: new URL("/oauth2/device/code", server.url).toString(),
  }
}

describe("plugin.xai", () => {
  describe("accessTokenIsExpiring", () => {
    test("returns true for an already-expired JWT", () => {
      expect(accessTokenIsExpiring(makeJwt({ exp: Math.floor(Date.now() / 1000) - 60 }), 0)).toBe(true)
    })

    test("returns false for a fresh JWT outside the skew window", () => {
      expect(accessTokenIsExpiring(makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }), 0)).toBe(false)
    })

    test("honors the skew window", () => {
      const nearExpiry = makeJwt({ exp: Math.floor(Date.now() / 1000) + 30 })
      expect(accessTokenIsExpiring(nearExpiry, 60_000)).toBe(true)
      expect(accessTokenIsExpiring(nearExpiry, 0)).toBe(false)
    })

    test("clamps negative skew to zero rather than refusing to refresh", () => {
      expect(accessTokenIsExpiring(makeJwt({ exp: Math.floor(Date.now() / 1000) - 1 }), -60_000)).toBe(true)
    })

    test("returns false for opaque and malformed tokens", () => {
      expect(accessTokenIsExpiring("opaque-token-no-dots", 0)).toBe(false)
      expect(accessTokenIsExpiring("", 0)).toBe(false)
      expect(accessTokenIsExpiring(undefined, 0)).toBe(false)
      expect(accessTokenIsExpiring(makeJwt({ sub: "user-1" }), 0)).toBe(false)
      expect(accessTokenIsExpiring(makeJwt({ exp: "1234" }), 0)).toBe(false)
      expect(accessTokenIsExpiring("header.!!!not-valid-base64-or-json!!!.sig", 0)).toBe(false)
    })
  })

  describe("buildAuthorizeUrl", () => {
    const pkce = { verifier: "ver", challenge: "chal" }

    test("includes required OAuth + PKCE + OIDC params", () => {
      const url = new URL(buildAuthorizeUrl(pkce, "state-abc", "nonce-xyz"))
      const params = url.searchParams

      expect(url.origin + url.pathname).toBe("https://auth.x.ai/oauth2/authorize")
      expect(params.get("response_type")).toBe("code")
      expect(params.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828")
      expect(params.get("redirect_uri")).toBe("http://127.0.0.1:56121/callback")
      expect(params.get("scope")).toBe("openid profile email offline_access grok-cli:access api:access")
      expect(params.get("code_challenge")).toBe("chal")
      expect(params.get("code_challenge_method")).toBe("S256")
      expect(params.get("state")).toBe("state-abc")
      expect(params.get("nonce")).toBe("nonce-xyz")
      expect(params.get("plan")).toBe("generic")
      expect(params.get("referrer")).toBe("opencode")
    })

    test("supports endpoint override for local integration tests", () => {
      const url = new URL(buildAuthorizeUrl(pkce, "s", "n", { authorizeUrl: "http://127.0.0.1/oauth2/authorize" }))
      expect(url.origin + url.pathname).toBe("http://127.0.0.1/oauth2/authorize")
    })
  })

  describe("escapeHtml", () => {
    test("escapes HTML metacharacters", () => {
      expect(escapeHtml(`</div><script>alert(1)</script><div class="x">`)).toBe(
        "&lt;/div&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;div class=&quot;x&quot;&gt;",
      )
      expect(escapeHtml("a & b")).toBe("a &amp; b")
      expect(escapeHtml("it's fine")).toBe("it&#39;s fine")
      expect(escapeHtml("invalid_grant")).toBe("invalid_grant")
      expect(escapeHtml("")).toBe("")
      expect(escapeHtml("&<")).toBe("&amp;&lt;")
    })
  })

  describe("loader", () => {
    test("returns no options unless stored auth is OAuth and exposes methods in order", async () => {
      const hooks = await XaiAuthPlugin({} as any)
      expect(await hooks.auth!.loader!(async () => ({ type: "api", key: "sk-test" }), {} as any)).toEqual({})
      expect(await hooks.auth!.loader!(async () => ({ type: "wellknown", key: "k", token: "t" }) as any, {} as any)).toEqual({})
      expect(hooks.auth!.methods.map((m) => [m.type, m.label])).toEqual([
        ["oauth", "xAI Grok OAuth (SuperGrok Subscription)"],
        ["oauth", "xAI Grok OAuth (Headless / Remote / VPS)"],
        ["api", "Manually enter API Key"],
      ])
    })

    test("replaces the dummy bearer, sets User-Agent, and preserves caller headers", async () => {
      const { input } = makeInput()
      const captured: Headers[] = []
      using server = makeServer((request) => {
        captured.push(request.headers)
        return new Response("{}", { status: 200 })
      })
      const hooks = await XaiAuthPlugin(input)
      const opts = await hooks.auth!.loader!(
        async () => ({ type: "oauth", access: "live-token", refresh: "rt", expires: Date.now() + 3600_000 }),
        {} as any,
      )
      expect(opts.apiKey).toBe(OAUTH_DUMMY_KEY)
      expect(opts.baseURL).toBeUndefined()

      await opts.fetch!(new URL("/chat/completions", server.url), {
        headers: { Authorization: `Bearer ${OAUTH_DUMMY_KEY}`, "x-keep": "yes" },
      })

      expect(captured[0].get("authorization")).toBe("Bearer live-token")
      expect(captured[0].get("x-keep")).toBe("yes")
      expect(captured[0].get("user-agent")).toMatch(/^opencode\//)
    })

    test("does not mutate caller headers and supports HeadersInit shapes", async () => {
      const { input } = makeInput()
      const captured: Headers[] = []
      using server = makeServer((request) => {
        captured.push(request.headers)
        return new Response("{}", { status: 200 })
      })
      const opts = await (await XaiAuthPlugin(input)).auth!.loader!(
        async () => ({ type: "oauth", access: "tok", refresh: "rt", expires: Date.now() + 3600_000 }),
        {} as any,
      )

      const objHeaders: Record<string, string> = { Authorization: `Bearer ${OAUTH_DUMMY_KEY}`, "x-trace": "plain-object" }
      await opts.fetch!(new URL("/chat/completions", server.url), { headers: objHeaders })
      expect(objHeaders).toEqual({ Authorization: `Bearer ${OAUTH_DUMMY_KEY}`, "x-trace": "plain-object" })

      const arrayHeaders: [string, string][] = [["x-trace", "tuple-array"]]
      const arrayCopy = arrayHeaders.map(([key, value]) => [key, value] as [string, string])
      await opts.fetch!(new URL("/chat/completions", server.url), { headers: arrayHeaders })
      expect(arrayHeaders).toEqual(arrayCopy)

      const headersInstance = new Headers({ "x-trace": "headers-instance" })
      await opts.fetch!(new URL("/chat/completions", server.url), { headers: headersInstance })
      expect(headersInstance.get("x-trace")).toBe("headers-instance")

      expect(captured.map((headers) => headers.get("x-trace"))).toEqual(["plain-object", "tuple-array", "headers-instance"])
      for (const headers of captured) {
        expect(headers.get("authorization")).toBe("Bearer tok")
        expect(headers.get("user-agent")).toMatch(/^opencode\//)
      }
    })

    test("preserves headers from Request input and lets init headers override them", async () => {
      const { input } = makeInput()
      const captured: Headers[] = []
      using server = makeServer((request) => {
        captured.push(request.headers)
        return new Response("{}", { status: 200 })
      })
      const opts = await (await XaiAuthPlugin(input)).auth!.loader!(
        async () => ({ type: "oauth", access: "tok", refresh: "rt", expires: Date.now() + 3600_000 }),
        {} as any,
      )

      await opts.fetch!(
        new Request(new URL("/chat/completions", server.url), {
          headers: { Authorization: `Bearer ${OAUTH_DUMMY_KEY}`, "content-type": "application/json", "x-trace": "request" },
        }),
        { headers: { "x-trace": "init", "x-extra": "yes" } },
      )

      expect(captured[0].get("authorization")).toBe("Bearer tok")
      expect(captured[0].get("content-type")).toBe("application/json")
      expect(captured[0].get("x-trace")).toBe("init")
      expect(captured[0].get("x-extra")).toBe("yes")
    })

    test("falls through to plain fetch when stored auth flips from oauth to api", async () => {
      const { input } = makeInput()
      const captured: Headers[] = []
      using server = makeServer((request) => {
        captured.push(request.headers)
        return new Response("{}", { status: 200 })
      })
      let firstCall = true
      const opts = await (await XaiAuthPlugin(input)).auth!.loader!(async () => {
        if (firstCall) {
          firstCall = false
          return { type: "oauth", access: "tok", refresh: "rt", expires: Date.now() + 3600_000 }
        }
        return { type: "api", key: "sk-new" }
      }, {} as any)

      await opts.fetch!(new URL("/chat/completions", server.url), {
        headers: { Authorization: "Bearer sk-from-aisdk", "x-keep": "v" },
      })
      expect(captured[0].get("authorization")).toBe("Bearer sk-from-aisdk")
      expect(captured[0].get("x-keep")).toBe("v")
    })

    test("deduplicates concurrent refreshes within a loader instance", async () => {
      const { input, setCalls } = makeInput()
      let tokenRequests = 0
      const apiRequests: Headers[] = []
      using server = makeServer(async (request, url) => {
        if (url.pathname === "/oauth2/token") {
          tokenRequests++
          expect(await request.text()).toContain("refresh_token=rt-old")
          await new Promise((resolve) => setTimeout(resolve, 30))
          return Response.json({ access_token: "new-access", refresh_token: "rt-new", expires_in: 3600 })
        }
        apiRequests.push(request.headers)
        return new Response("{}", { status: 200 })
      })
      const opts = await (await XaiAuthPlugin(input, serverOptions(server))).auth!.loader!(
        async () => ({ type: "oauth" as const, access: "old", refresh: "rt-old", expires: 0 }),
        {} as any,
      )

      await Promise.all([
        opts.fetch!(new URL("/chat/completions", server.url), { headers: {} }),
        opts.fetch!(new URL("/chat/completions", server.url), { headers: {} }),
      ])

      expect(tokenRequests).toBe(1)
      expect(apiRequests.map((headers) => headers.get("authorization"))).toEqual(["Bearer new-access", "Bearer new-access"])
      expect(setCalls).toHaveLength(1)
      expect((setCalls[0].body as any).refresh).toBe("rt-new")
    })

    test("does not share refresh single-flight across loader instances", async () => {
      const { input } = makeInput()
      const tokenRequests: string[] = []
      const apiRequests: string[] = []
      using server = makeServer(async (request, url) => {
        if (url.pathname === "/oauth2/token") {
          const refreshToken = new URLSearchParams(await request.text()).get("refresh_token")!
          tokenRequests.push(refreshToken)
          await new Promise((resolve) => setTimeout(resolve, 20))
          return Response.json({ access_token: `access-${refreshToken}`, refresh_token: `next-${refreshToken}`, expires_in: 3600 })
        }
        apiRequests.push(request.headers.get("authorization")!)
        return new Response("{}", { status: 200 })
      })
      const hooks = await XaiAuthPlugin(input, serverOptions(server))
      const first = await hooks.auth!.loader!(async () => ({ type: "oauth", access: "old-a", refresh: "rt-a", expires: 0 }), {} as any)
      const second = await hooks.auth!.loader!(async () => ({ type: "oauth", access: "old-b", refresh: "rt-b", expires: 0 }), {} as any)

      await Promise.all([
        first.fetch!(new URL("/chat/completions", server.url), { headers: {} }),
        second.fetch!(new URL("/chat/completions", server.url), { headers: {} }),
      ])

      expect(tokenRequests.sort()).toEqual(["rt-a", "rt-b"])
      expect(apiRequests.sort()).toEqual(["Bearer access-rt-a", "Bearer access-rt-b"])
    })

    test("starts a new refresh after success and clears the refresh promise after failure", async () => {
      const { input } = makeInput()
      let tokenRequests = 0
      using server = makeServer((_, url) => {
        if (url.pathname === "/oauth2/token") {
          tokenRequests++
          if (tokenRequests === 2) return new Response("temporarily unavailable", { status: 503 })
          return Response.json({ access_token: `new-${tokenRequests}`, refresh_token: `rt-${tokenRequests}`, expires_in: 3600 })
        }
        return new Response("{}", { status: 200 })
      })
      const opts = await (await XaiAuthPlugin(input, serverOptions(server))).auth!.loader!(
        async () => ({ type: "oauth", access: "old", refresh: "rt-old", expires: 0 }),
        {} as any,
      )

      await opts.fetch!(new URL("/chat/completions", server.url), { headers: {} })
      await expect(opts.fetch!(new URL("/chat/completions", server.url), { headers: {} })).rejects.toThrow(/xAI token refresh failed \(503\)/)
      await opts.fetch!(new URL("/chat/completions", server.url), { headers: {} })
      expect(tokenRequests).toBe(3)
    })

    test("handles refresh response variants and persistence failure", async () => {
      const { input, setCalls } = makeInput({ failSet: true })
      const captured: Headers[] = []
      using server = makeServer((request, url) => {
        if (url.pathname === "/oauth2/token") return Response.json({ access_token: "new-access", expires_in: 3600 })
        captured.push(request.headers)
        return new Response("{}", { status: 200 })
      })
      const opts = await (await XaiAuthPlugin(input, serverOptions(server))).auth!.loader!(
        async () => ({ type: "oauth", access: "old", refresh: "rt-old", expires: 0 }),
        {} as any,
      )

      const resp = await opts.fetch!(new URL("/chat/completions", server.url), { headers: {} })
      expect(resp.status).toBe(200)
      expect(captured[0].get("authorization")).toBe("Bearer new-access")
      expect((setCalls[0].body as any).refresh).toBe("rt-old")
    })

    test("refreshes based on stored expiry or JWT expiry and skips refresh when both are fresh", async () => {
      const { input, setCalls } = makeInput()
      let tokenRequests = 0
      using server = makeServer((_, url) => {
        if (url.pathname === "/oauth2/token") {
          tokenRequests++
          return Response.json({ access_token: "new-access", refresh_token: "rt-new", expires_in: 3600 })
        }
        return new Response("{}", { status: 200 })
      })
      const fresh = await (await XaiAuthPlugin(input, serverOptions(server))).auth!.loader!(
        async () => ({
          type: "oauth",
          access: makeJwt({ exp: Math.floor(Date.now() / 1000) + 24 * 3600 }),
          refresh: "rt",
          expires: Date.now() + 24 * 3600 * 1000,
        }),
        {} as any,
      )
      await fresh.fetch!(new URL("/chat/completions", server.url), { headers: {} })
      expect(tokenRequests).toBe(0)

      const jwtExpiring = await (await XaiAuthPlugin(input, serverOptions(server))).auth!.loader!(
        async () => ({
          type: "oauth",
          access: makeJwt({ exp: Math.floor((Date.now() + 30_000) / 1000) }),
          refresh: "rt-old",
          expires: Date.now() + 24 * 3600 * 1000,
        }),
        {} as any,
      )
      const missingExpires = await (await XaiAuthPlugin(input, serverOptions(server))).auth!.loader!(
        async () => ({ type: "oauth", access: "opaque-token", refresh: "rt", expires: 0 }),
        {} as any,
      )
      await jwtExpiring.fetch!(new URL("/chat/completions", server.url), { headers: {} })
      await missingExpires.fetch!(new URL("/chat/completions", server.url), { headers: {} })
      expect(tokenRequests).toBe(2)
      expect(setCalls).toHaveLength(2)
    })

    test("network failure during refresh surfaces the underlying fetch error", async () => {
      const { input } = makeInput()
      const opts = await (await XaiAuthPlugin(input, { tokenUrl: "http://127.0.0.1:9/oauth2/token" })).auth!.loader!(
        async () => ({ type: "oauth", access: "old", refresh: "rt", expires: 0 }),
        {} as any,
      )

      await expect(opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: {} })).rejects.toThrow()
    })
  })

  describe("device code flow", () => {
    test("authorize advertises verification URL + user code and returns success on callback", async () => {
      using server = makeServer((_, url) => {
        if (url.pathname === "/oauth2/device/code") {
          return Response.json({
            device_code: "DEVICE-1",
            user_code: "ABCD-1234",
            verification_uri: "https://x.ai/device",
            verification_uri_complete: "https://x.ai/device?user_code=ABCD-1234",
            expires_in: 600,
            interval: 5,
          })
        }
        if (url.pathname === "/oauth2/token") {
          return Response.json({ access_token: "AT", refresh_token: "RT", expires_in: 3600 })
        }
        return new Response("unexpected request", { status: 500 })
      })
      const hooks = await XaiAuthPlugin({} as any, serverOptions(server))
      const headless = hooks.auth!.methods.find((m): m is Extract<typeof m, { type: "oauth" }> => m.type === "oauth" && m.label === "xAI Grok OAuth (Headless / Remote / VPS)")!
      const result = await headless.authorize!()

      expect(result.method).toBe("auto")
      expect(result.url).toBe("https://x.ai/device?user_code=ABCD-1234")
      expect(result.instructions).toContain("https://x.ai/device")
      expect(result.instructions).toContain("ABCD-1234")
      expect(await (result as any).callback()).toMatchObject({ type: "success", refresh: "RT", access: "AT" })
    })

    test("authorize falls back to verification_uri when verification_uri_complete is absent", async () => {
      using server = makeServer((_, url) => {
        if (url.pathname === "/oauth2/device/code") {
          return Response.json({ device_code: "DEVICE-2", user_code: "WXYZ-9876", verification_uri: "https://x.ai/device" })
        }
        return new Response("unexpected request", { status: 500 })
      })
      const headless = (await XaiAuthPlugin({} as any, serverOptions(server))).auth!.methods.find(
        (m): m is Extract<typeof m, { type: "oauth" }> => m.type === "oauth" && m.label === "xAI Grok OAuth (Headless / Remote / VPS)",
      )!
      expect((await headless.authorize!()).url).toBe("https://x.ai/device")
    })

    test("requestDeviceCode posts form body, validates fields, and surfaces endpoint errors", async () => {
      let capturedBody = ""
      using server = makeServer(async (request, url) => {
        if (url.pathname === "/missing") return Response.json({ device_code: "x" })
        if (url.pathname === "/error") return new Response("rate limited", { status: 429 })
        expect(request.method).toBe("POST")
        expect(request.headers.get("content-type")).toBe("application/x-www-form-urlencoded")
        expect(request.headers.get("accept")).toBe("application/json")
        expect(request.headers.get("user-agent")).toMatch(/^opencode\//)
        capturedBody = await request.text()
        return Response.json({ device_code: "DC", user_code: "UC", verification_uri: "https://x.ai/device" })
      })

      await requestDeviceCode({ deviceAuthorizationUrl: new URL("/oauth2/device/code", server.url).toString() })
      const parsed = new URLSearchParams(capturedBody)
      expect(parsed.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828")
      expect(parsed.get("scope")).toContain("offline_access")
      expect(parsed.get("scope")).toContain("grok-cli:access")
      expect(parsed.get("scope")).toContain("api:access")
      await expect(requestDeviceCode({ deviceAuthorizationUrl: new URL("/error", server.url).toString() })).rejects.toThrow(/429.*rate limited/)
      await expect(requestDeviceCode({ deviceAuthorizationUrl: new URL("/missing", server.url).toString() })).rejects.toThrow(/missing device_code/)
    })

    test("pollDeviceCodeToken resolves on success and posts the device-code grant", async () => {
      let tokenCalls = 0
      using server = makeServer(async (request) => {
        tokenCalls++
        expect(request.headers.get("content-type")).toBe("application/x-www-form-urlencoded")
        const body = new URLSearchParams(await request.text())
        expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code")
        expect(body.get("device_code")).toBe("DC-1")
        return Response.json({ access_token: "AT", refresh_token: "RT", expires_in: 3600 })
      })

      const tokens = await pollDeviceCodeToken(
        { device_code: "DC-1", user_code: "UC", verification_uri: "https://x.ai/device", interval: 1, expires_in: 600 },
        { sleep: async () => {}, tokenUrl: new URL("/oauth2/token", server.url).toString() },
      )
      expect(tokens.access_token).toBe("AT")
      expect(tokens.refresh_token).toBe("RT")
      expect(tokenCalls).toBe(1)
    })

    test("pollDeviceCodeToken honors authorization_pending and slow_down", async () => {
      let n = 0
      using server = makeServer(() => {
        n++
        if (n === 1) return Response.json({ error: "authorization_pending" }, { status: 400 })
        if (n === 2) return Response.json({ error: "slow_down" }, { status: 400 })
        return Response.json({ access_token: "AT", refresh_token: "RT", expires_in: 3600 })
      })
      const sleeps: number[] = []
      const tokens = await pollDeviceCodeToken(
        { device_code: "DC", user_code: "UC", verification_uri: "https://x.ai/device", interval: 5, expires_in: 600 },
        { sleep: async (ms) => void sleeps.push(ms), tokenUrl: new URL("/oauth2/token", server.url).toString() },
      )
      expect(tokens.access_token).toBe("AT")
      expect(n).toBe(3)
      expect(sleeps).toEqual([8_000, 13_000])
    })

    test("pollDeviceCodeToken handles terminal errors and timeout", async () => {
      for (const [body, error] of [
        [{ error: "access_denied" }, /authorization was denied/],
        [{ error: "expired_token" }, /device code expired/],
        [{ error: "server_error", error_description: "oops" }, /500.*oops/],
      ] as const) {
        using server = makeServer(() => Response.json(body, { status: 500 }))
        await expect(
          pollDeviceCodeToken(
            { device_code: "DC", user_code: "UC", verification_uri: "https://x.ai/device", interval: 1, expires_in: 600 },
            { sleep: async () => {}, tokenUrl: new URL("/oauth2/token", server.url).toString() },
          ),
        ).rejects.toThrow(error)
      }

      using pending = makeServer(() => Response.json({ error: "authorization_pending" }, { status: 400 }))
      let tick = 0
      await expect(
        pollDeviceCodeToken(
          { device_code: "DC", user_code: "UC", verification_uri: "https://x.ai/device", interval: 1, expires_in: 1 },
          { sleep: async () => {}, now: () => 1_000_000 + tick++ * 600, tokenUrl: new URL("/oauth2/token", pending.url).toString() },
        ),
      ).rejects.toThrow(/timed out/)
    })

    test("pollDeviceCodeToken normalizes bad interval and expires_in values", async () => {
      const badIntervals: Array<unknown> = [Number.NaN, "NaN", "garbage", -5, null, 0]
      for (const bad of badIntervals) {
        let n = 0
        using server = makeServer(() => {
          n++
          if (n === 1) return Response.json({ error: "authorization_pending" }, { status: 400 })
          return Response.json({ access_token: "AT", refresh_token: "RT", expires_in: 3600 })
        })
        const sleeps: number[] = []
        await pollDeviceCodeToken(
          { device_code: "DC", user_code: "UC", verification_uri: "https://x.ai/device", interval: bad as number, expires_in: 600 },
          { sleep: async (ms) => void sleeps.push(ms), tokenUrl: new URL("/oauth2/token", server.url).toString() },
        )
        expect(sleeps[0]).toBe(8_000)
      }

      for (const bad of [Number.NaN, "NaN", "garbage", -5, null, 0]) {
        using server = makeServer(() => Response.json({ access_token: "AT", refresh_token: "RT", expires_in: 3600 }))
        expect(
          (
            await pollDeviceCodeToken(
              { device_code: "DC", user_code: "UC", verification_uri: "https://x.ai/device", interval: 1, expires_in: bad as number },
              { sleep: async () => {}, tokenUrl: new URL("/oauth2/token", server.url).toString() },
            )
          ).access_token,
        ).toBe("AT")
      }
    })

    test("device-code authorize callback returns failed when polling errors", async () => {
      using server = makeServer((_, url) => {
        if (url.pathname === "/oauth2/device/code") {
          return Response.json({ device_code: "DC", user_code: "UC", verification_uri: "https://x.ai/device", interval: 0, expires_in: 600 })
        }
        return Response.json({ error: "access_denied" }, { status: 400 })
      })
      const headless = (await XaiAuthPlugin({} as any, serverOptions(server))).auth!.methods.find(
        (m): m is Extract<typeof m, { type: "oauth" }> => m.type === "oauth" && m.label === "xAI Grok OAuth (Headless / Remote / VPS)",
      )!
      expect(await (await headless.authorize!() as any).callback()).toEqual({ type: "failed" })
    })
  })
})

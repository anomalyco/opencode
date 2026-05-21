import { afterEach, describe, expect, mock, test } from "bun:test"
import {
  __resetForTests,
  accessTokenIsExpiring,
  buildAuthorizeUrl,
  escapeHtml,
  pollDeviceCodeToken,
  requestDeviceCode,
  XaiAuthPlugin,
} from "../../src/plugin/xai"
import { OAUTH_DUMMY_KEY } from "../../src/auth"

function makeJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

describe("plugin.xai", () => {
  describe("accessTokenIsExpiring", () => {
    test("returns true for an already-expired JWT", () => {
      const expired = makeJwt({ exp: Math.floor(Date.now() / 1000) - 60 })
      expect(accessTokenIsExpiring(expired, 0)).toBe(true)
    })

    test("returns false for a fresh JWT outside the skew window", () => {
      const fresh = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
      expect(accessTokenIsExpiring(fresh, 0)).toBe(false)
    })

    test("honors the skew window", () => {
      const nearExpiry = makeJwt({ exp: Math.floor(Date.now() / 1000) + 30 })
      expect(accessTokenIsExpiring(nearExpiry, 60_000)).toBe(true)
      expect(accessTokenIsExpiring(nearExpiry, 0)).toBe(false)
    })

    test("clamps negative skew to zero rather than refusing to refresh", () => {
      const justExpired = makeJwt({ exp: Math.floor(Date.now() / 1000) - 1 })
      expect(accessTokenIsExpiring(justExpired, -60_000)).toBe(true)
    })

    test("returns false for opaque (non-JWT) tokens", () => {
      // Opaque tokens can't be inspected; conservatively skip the proactive
      // refresh and let the stored expires field / 401-on-call drive refresh.
      expect(accessTokenIsExpiring("opaque-token-no-dots", 0)).toBe(false)
      expect(accessTokenIsExpiring("", 0)).toBe(false)
      expect(accessTokenIsExpiring(undefined, 0)).toBe(false)
    })

    test("returns false for a JWT without an exp claim", () => {
      const noExp = makeJwt({ sub: "user-1" })
      expect(accessTokenIsExpiring(noExp, 0)).toBe(false)
    })

    test("returns false for a JWT whose exp claim is not a number", () => {
      const stringExp = makeJwt({ exp: "1234" })
      expect(accessTokenIsExpiring(stringExp, 0)).toBe(false)
    })

    test("returns false for a JWT with a malformed (non-base64) payload", () => {
      const garbage = "header.!!!not-valid-base64-or-json!!!.sig"
      expect(accessTokenIsExpiring(garbage, 0)).toBe(false)
    })

    test("returns false for a JWT whose payload decodes but isn't JSON", () => {
      const headerB64 = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
      const notJsonB64 = Buffer.from("not-json-just-text").toString("base64url")
      expect(accessTokenIsExpiring(`${headerB64}.${notJsonB64}.sig`, 0)).toBe(false)
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
    })

    test("includes plan=generic so accounts.x.ai accepts the loopback client", () => {
      // Regression: without plan=generic, xAI's consent screen rejects
      // non-allowlisted clients on the loopback OAuth path.
      const params = new URL(buildAuthorizeUrl(pkce, "s", "n")).searchParams
      expect(params.get("plan")).toBe("generic")
    })

    test("includes referrer=opencode for attribution", () => {
      const params = new URL(buildAuthorizeUrl(pkce, "s", "n")).searchParams
      expect(params.get("referrer")).toBe("opencode")
    })

    test("propagates fresh state/nonce on every call", () => {
      // The caller is expected to pass unique state/nonce per attempt; we
      // verify the builder doesn't accidentally cache or share them.
      const a = new URL(buildAuthorizeUrl(pkce, "state-1", "nonce-1")).searchParams
      const b = new URL(buildAuthorizeUrl(pkce, "state-2", "nonce-2")).searchParams
      expect(a.get("state")).toBe("state-1")
      expect(b.get("state")).toBe("state-2")
      expect(a.get("nonce")).toBe("nonce-1")
      expect(b.get("nonce")).toBe("nonce-2")
    })
  })

  describe("escapeHtml", () => {
    test("escapes HTML metacharacters that would otherwise let an xAI error_description inject script tags into the loopback callback page", () => {
      expect(escapeHtml(`</div><script>alert(1)</script><div class="x">`)).toBe(
        "&lt;/div&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;div class=&quot;x&quot;&gt;",
      )
      expect(escapeHtml("a & b")).toBe("a &amp; b")
      expect(escapeHtml("it's fine")).toBe("it&#39;s fine")
    })

    test("leaves plain text unchanged", () => {
      expect(escapeHtml("invalid_grant")).toBe("invalid_grant")
    })

    test("handles empty input without throwing", () => {
      expect(escapeHtml("")).toBe("")
    })

    test("escapes ampersand before angle brackets so &lt; isn't double-encoded", () => {
      // Regression guard: a naive implementation that runs the < replacement
      // before & would turn "<" into "&lt;" and then turn the & into &amp;,
      // producing "&amp;lt;" which renders the literal text "&lt;" instead
      // of an escaped less-than sign.
      expect(escapeHtml("<")).toBe("&lt;")
      expect(escapeHtml("&<")).toBe("&amp;&lt;")
    })
  })

  describe("loader gating", () => {
    test("returns no options when stored auth is an API key (not OAuth)", async () => {
      // Contract: a user who has pasted an XAI_API_KEY (or hasn't connected
      // OAuth) must not see the OAuth fetch hook installed — otherwise the
      // hook would short-circuit their API-key flow.
      const hooks = await XaiAuthPlugin({} as any)
      const opts = await hooks.auth!.loader!(
        async () => ({ type: "api", key: "sk-test" }),
        {} as any,
      )
      expect(opts).toEqual({})
    })

    test("returns no options for non-oauth, non-api stored auth shapes (wellknown)", async () => {
      const hooks = await XaiAuthPlugin({} as any)
      const opts = await hooks.auth!.loader!(
        async () => ({ type: "wellknown", key: "k", token: "t" }) as any,
        {} as any,
      )
      expect(opts).toEqual({})
    })

    test("exposes browser OAuth, headless device-code OAuth, and API-key fallback in that order", async () => {
      const hooks = await XaiAuthPlugin({} as any)
      const methods = hooks.auth!.methods
      expect(methods).toHaveLength(3)
      expect(methods[0].type).toBe("oauth")
      expect(methods[0].label).toBe("xAI Grok OAuth (SuperGrok Subscription)")
      expect(methods[1].type).toBe("oauth")
      expect(methods[1].label).toBe("xAI Grok OAuth (Headless / Remote / VPS)")
      expect(methods[2].type).toBe("api")
      expect(methods[2].label).toBe("Manually enter API Key")
    })
  })

  describe("loader.fetch", () => {
    // Stub a minimal PluginInput.client.auth that captures persisted token
    // pairs so we can verify the rotating refresh_token is written back.
    function makeInput(opts?: { failSet?: boolean }) {
      const setCalls: Array<Record<string, unknown>> = []
      return {
        input: {
          client: {
            auth: {
              set: async (req: Record<string, unknown>) => {
                setCalls.push(req)
                if (opts?.failSet) throw new Error("auth.set boom")
                return undefined
              },
            },
          },
        } as any,
        setCalls,
      }
    }

    const originalFetch = globalThis.fetch
    afterEach(() => {
      globalThis.fetch = originalFetch
      __resetForTests()
    })

    test("replaces the dummy bearer with the OAuth access token and sets User-Agent", async () => {
      const { input } = makeInput()
      const hooks = await XaiAuthPlugin(input)
      const loader = hooks.auth!.loader!
      const futureExpires = Date.now() + 60 * 60 * 1000
      const opts = await loader(
        async () => ({ type: "oauth", access: "live-token", refresh: "rt", expires: futureExpires }),
        {} as any,
      )
      expect(opts.apiKey).toBe(OAUTH_DUMMY_KEY)
      // Intentionally no baseURL — defaulting to @ai-sdk/xai's built-in
      // base URL lets users keep a corporate gateway configured.
      expect(opts.baseURL).toBeUndefined()

      const seen: { url: string; headers: Headers }[] = []
      globalThis.fetch = mock(async (url: any, init?: RequestInit) => {
        seen.push({ url: String(url), headers: new Headers(init?.headers as HeadersInit) })
        return new Response("{}", { status: 200 })
      }) as any

      await opts.fetch!("https://api.x.ai/v1/chat/completions", {
        headers: { Authorization: `Bearer ${OAUTH_DUMMY_KEY}`, "x-keep": "yes" },
      })

      expect(seen).toHaveLength(1)
      expect(seen[0].headers.get("authorization")).toBe("Bearer live-token")
      expect(seen[0].headers.get("x-keep")).toBe("yes")
      expect(seen[0].headers.get("user-agent")).toMatch(/^opencode\//)
    })

    test("does not mutate the caller's init.headers (would break AI SDK retries that reuse the init object)", async () => {
      const { input } = makeInput()
      const hooks = await XaiAuthPlugin(input)
      const opts = await hooks.auth!.loader!(
        async () => ({
          type: "oauth",
          access: "live-token",
          refresh: "rt",
          expires: Date.now() + 60 * 60 * 1000,
        }),
        {} as any,
      )

      globalThis.fetch = mock(async () => new Response("{}", { status: 200 })) as any

      const objHeaders: Record<string, string> = { Authorization: `Bearer ${OAUTH_DUMMY_KEY}`, "x-keep": "v" }
      await opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: objHeaders })
      expect(objHeaders).toEqual({ Authorization: `Bearer ${OAUTH_DUMMY_KEY}`, "x-keep": "v" })

      const arrayHeaders: [string, string][] = [
        ["Authorization", `Bearer ${OAUTH_DUMMY_KEY}`],
        ["x-keep", "v"],
      ]
      const arrayCopy = arrayHeaders.map(([k, v]) => [k, v] as [string, string])
      await opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: arrayHeaders })
      expect(arrayHeaders).toEqual(arrayCopy)

      const headersInstance = new Headers({ Authorization: `Bearer ${OAUTH_DUMMY_KEY}`, "x-keep": "v" })
      await opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: headersInstance })
      expect(headersInstance.get("authorization")).toBe(`Bearer ${OAUTH_DUMMY_KEY}`)
      expect(headersInstance.get("x-keep")).toBe("v")
    })

    test("supports all three HeadersInit shapes (Headers, tuple array, plain object) and merges User-Agent + OAuth bearer", async () => {
      const { input } = makeInput()
      const hooks = await XaiAuthPlugin(input)
      const opts = await hooks.auth!.loader!(
        async () => ({ type: "oauth", access: "tok", refresh: "rt", expires: Date.now() + 3600_000 }),
        {} as any,
      )

      const captured: Headers[] = []
      globalThis.fetch = mock(async (_url: any, init?: RequestInit) => {
        captured.push(new Headers(init?.headers as HeadersInit))
        return new Response("{}", { status: 200 })
      }) as any

      await opts.fetch!("https://api.x.ai/v1/chat/completions", {
        headers: new Headers({ "x-trace": "headers-instance" }),
      })
      await opts.fetch!("https://api.x.ai/v1/chat/completions", {
        headers: [
          ["x-trace", "tuple-array"],
          ["x-skip-undef", undefined as unknown as string],
        ],
      })
      await opts.fetch!("https://api.x.ai/v1/chat/completions", {
        headers: { "x-trace": "plain-object", "x-skip-undef": undefined as unknown as string },
      })

      expect(captured.map((h) => h.get("x-trace"))).toEqual(["headers-instance", "tuple-array", "plain-object"])
      // Undefined values are filtered to avoid Headers TypeErrors and to
      // preserve the documented "omit the header" semantics.
      expect(captured[1].get("x-skip-undef")).toBeNull()
      expect(captured[2].get("x-skip-undef")).toBeNull()
      for (const h of captured) {
        expect(h.get("authorization")).toBe("Bearer tok")
        expect(h.get("user-agent")).toMatch(/^opencode\//)
      }
    })

    test("falls through to plain fetch with caller headers intact when stored auth flips from oauth to api mid-session", async () => {
      // Regression: an earlier version stripped the Authorization header
      // before checking auth.type, so a user who switched from OAuth back
      // to an API key mid-session would have the AI SDK's own bearer
      // silently deleted from the outgoing request.
      const { input } = makeInput()
      const hooks = await XaiAuthPlugin(input)
      let firstCall = true
      const opts = await hooks.auth!.loader!(async () => {
        if (firstCall) {
          firstCall = false
          return { type: "oauth", access: "tok", refresh: "rt", expires: Date.now() + 3600_000 }
        }
        return { type: "api", key: "sk-new" }
      }, {} as any)

      const captured: Headers[] = []
      globalThis.fetch = mock(async (_url: any, init?: RequestInit) => {
        captured.push(new Headers(init?.headers as HeadersInit))
        return new Response("{}", { status: 200 })
      }) as any

      await opts.fetch!("https://api.x.ai/v1/chat/completions", {
        headers: { Authorization: "Bearer sk-from-aisdk", "x-keep": "v" },
      })
      expect(captured).toHaveLength(1)
      expect(captured[0].get("authorization")).toBe("Bearer sk-from-aisdk")
      expect(captured[0].get("x-keep")).toBe("v")
    })

    test("refreshes via single-flight when two concurrent calls both see an expiring token, calling getAuth exactly once per fetch + once for the outer loader", async () => {
      // The race we are protecting against: xAI rotates refresh_token on
      // every refresh, so two parallel loader.fetch calls reading the same
      // consumed refresh_token would 4xx on the second exchange.
      const { input, setCalls } = makeInput()
      const hooks = await XaiAuthPlugin(input)
      const loader = hooks.auth!.loader!
      const expiredAt = Date.now() - 60_000
      let getAuthCalls = 0
      const getAuth = async () => {
        getAuthCalls++
        return { type: "oauth" as const, access: "old", refresh: "rt-old", expires: expiredAt }
      }
      const opts = await loader(getAuth, {} as any)

      let tokenRequests = 0
      const apiRequests: Headers[] = []
      globalThis.fetch = mock(async (url: any, init?: RequestInit) => {
        const u = String(url)
        if (u === "https://auth.x.ai/oauth2/token") {
          tokenRequests++
          // Make the token endpoint genuinely slow so both fetches enter
          // the refresh branch before the first completes.
          await new Promise((r) => setTimeout(r, 50))
          return new Response(
            JSON.stringify({
              access_token: "new-access",
              refresh_token: "rt-new",
              expires_in: 3600,
              token_type: "Bearer",
            }),
            { status: 200 },
          )
        }
        apiRequests.push(new Headers(init?.headers as HeadersInit))
        return new Response("{}", { status: 200 })
      }) as any

      await Promise.all([
        opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: {} }),
        opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: {} }),
      ])

      expect(tokenRequests).toBe(1)
      expect(apiRequests).toHaveLength(2)
      expect(apiRequests[0].get("authorization")).toBe("Bearer new-access")
      expect(apiRequests[1].get("authorization")).toBe("Bearer new-access")
      // 1 outer loader call + 1 per fetch wrapper = 3 total. Tight assertion
      // so we notice if a regression silently doubles getAuth calls per fetch.
      expect(getAuthCalls).toBe(3)

      // Persist exactly one rotation, carrying the new refresh_token.
      const refreshSets = setCalls.filter((c) => (c.path as any)?.id === "xai")
      expect(refreshSets).toHaveLength(1)
      expect((refreshSets[0].body as any).refresh).toBe("rt-new")
      expect((refreshSets[0].body as any).access).toBe("new-access")
    })

    test("starts a NEW refresh after a prior single-flight completes (verifies inflight cleanup on success)", async () => {
      const { input } = makeInput()
      const hooks = await XaiAuthPlugin(input)
      // Always-expired stored auth so every fetch enters the refresh branch.
      const opts = await hooks.auth!.loader!(
        async () => ({ type: "oauth", access: "old", refresh: "rt-old", expires: 0 }),
        {} as any,
      )

      let tokenRequests = 0
      globalThis.fetch = mock(async (url: any) => {
        if (String(url) === "https://auth.x.ai/oauth2/token") {
          tokenRequests++
          return new Response(
            JSON.stringify({ access_token: `new-${tokenRequests}`, refresh_token: `rt-${tokenRequests}`, expires_in: 3600 }),
            { status: 200 },
          )
        }
        return new Response("{}", { status: 200 })
      }) as any

      await opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: {} })
      await opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: {} })

      expect(tokenRequests).toBe(2)
    })

    test("inflightRefresh is cleared after a failed refresh so the next call can retry", async () => {
      const { input } = makeInput()
      const hooks = await XaiAuthPlugin(input)
      const opts = await hooks.auth!.loader!(
        async () => ({ type: "oauth", access: "old", refresh: "rt-old", expires: 0 }),
        {} as any,
      )

      let attempts = 0
      globalThis.fetch = mock(async (url: any) => {
        if (String(url) === "https://auth.x.ai/oauth2/token") {
          attempts++
          if (attempts === 1) {
            return new Response("temporarily unavailable", { status: 503 })
          }
          return new Response(JSON.stringify({ access_token: "new", refresh_token: "rt-new", expires_in: 3600 }), {
            status: 200,
          })
        }
        return new Response("{}", { status: 200 })
      }) as any

      await expect(opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: {} })).rejects.toThrow(
        /xAI token refresh failed \(503\)/,
      )
      // Second attempt must NOT see a stuck inflight promise from attempt #1.
      const resp = await opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: {} })
      expect(resp.status).toBe(200)
      expect(attempts).toBe(2)
    })

    test("refresh error message includes HTTP status and response body for debuggability", async () => {
      const { input } = makeInput()
      const hooks = await XaiAuthPlugin(input)
      const opts = await hooks.auth!.loader!(
        async () => ({ type: "oauth", access: "old", refresh: "rt-old", expires: 0 }),
        {} as any,
      )

      globalThis.fetch = mock(
        async () => new Response('{"error":"invalid_grant"}', { status: 401 }),
      ) as any

      await expect(opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: {} })).rejects.toThrow(
        /xAI token refresh failed \(401\).*invalid_grant/,
      )
    })

    test("falls back to the previous refresh_token when the refresh response omits one", async () => {
      const { input, setCalls } = makeInput()
      const hooks = await XaiAuthPlugin(input)
      const loader = hooks.auth!.loader!
      const opts = await loader(
        async () => ({ type: "oauth", access: "old", refresh: "rt-old", expires: 0 }),
        {} as any,
      )

      globalThis.fetch = mock(async (url: any) => {
        if (String(url) === "https://auth.x.ai/oauth2/token") {
          return new Response(JSON.stringify({ access_token: "new-access", expires_in: 3600 }), { status: 200 })
        }
        return new Response("{}", { status: 200 })
      }) as any

      await opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: {} })

      const refreshSets = setCalls.filter((c) => (c.path as any)?.id === "xai")
      expect(refreshSets).toHaveLength(1)
      expect((refreshSets[0].body as any).refresh).toBe("rt-old")
      expect((refreshSets[0].body as any).access).toBe("new-access")
    })

    test("persistence failure does not break the in-flight request (the new access token still reaches the API call)", async () => {
      // Documents the M1 mitigation: we treat auth.set as best-effort so a
      // transient persistence failure doesn't blow up the live turn. The
      // on-disk state will be stale until the next successful refresh.
      const { input } = makeInput({ failSet: true })
      const hooks = await XaiAuthPlugin(input)
      const opts = await hooks.auth!.loader!(
        async () => ({ type: "oauth", access: "old", refresh: "rt-old", expires: 0 }),
        {} as any,
      )

      const captured: Headers[] = []
      globalThis.fetch = mock(async (url: any, init?: RequestInit) => {
        if (String(url) === "https://auth.x.ai/oauth2/token") {
          return new Response(
            JSON.stringify({ access_token: "new-access", refresh_token: "rt-new", expires_in: 3600 }),
            { status: 200 },
          )
        }
        captured.push(new Headers(init?.headers as HeadersInit))
        return new Response("{}", { status: 200 })
      }) as any

      const resp = await opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: {} })
      expect(resp.status).toBe(200)
      expect(captured).toHaveLength(1)
      expect(captured[0].get("authorization")).toBe("Bearer new-access")
    })

    test("does not refresh when both stored expiry and JWT exp are comfortably in the future", async () => {
      const { input, setCalls } = makeInput()
      const hooks = await XaiAuthPlugin(input)
      const loader = hooks.auth!.loader!
      const farFuture = Math.floor(Date.now() / 1000) + 24 * 3600
      const opts = await loader(
        async () => ({
          type: "oauth",
          access: makeJwt({ exp: farFuture }),
          refresh: "rt",
          expires: Date.now() + 24 * 3600 * 1000,
        }),
        {} as any,
      )

      let calledToken = false
      globalThis.fetch = mock(async (url: any) => {
        if (String(url) === "https://auth.x.ai/oauth2/token") calledToken = true
        return new Response("{}", { status: 200 })
      }) as any

      await opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: {} })
      expect(calledToken).toBe(false)
      expect(setCalls).toHaveLength(0)
    })

    test("refreshes when stored expires is fresh but the JWT exp claim is within the skew window", async () => {
      // Catches the case where auth.json carries a stale expires_in deadline
      // (because xAI didn't return expires_in on a previous refresh) but the
      // JWT itself is about to expire.
      const { input, setCalls } = makeInput()
      const hooks = await XaiAuthPlugin(input)
      const jwtExpInSkew = Math.floor((Date.now() + 30_000) / 1000) // expires in 30s
      const opts = await hooks.auth!.loader!(
        async () => ({
          type: "oauth",
          access: makeJwt({ exp: jwtExpInSkew }),
          refresh: "rt-old",
          // Stored expires is in the far future — only the JWT check can
          // catch this.
          expires: Date.now() + 24 * 3600 * 1000,
        }),
        {} as any,
      )

      let refreshed = false
      globalThis.fetch = mock(async (url: any) => {
        if (String(url) === "https://auth.x.ai/oauth2/token") {
          refreshed = true
          return new Response(
            JSON.stringify({ access_token: "new-access", refresh_token: "rt-new", expires_in: 3600 }),
            { status: 200 },
          )
        }
        return new Response("{}", { status: 200 })
      }) as any

      await opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: {} })
      expect(refreshed).toBe(true)
      expect(setCalls).toHaveLength(1)
    })

    test("refreshes when stored expires is 0 (initial state after a botched login that didn't persist a deadline)", async () => {
      const { input, setCalls } = makeInput()
      const hooks = await XaiAuthPlugin(input)
      const opts = await hooks.auth!.loader!(
        async () => ({ type: "oauth", access: "opaque-token", refresh: "rt", expires: 0 }),
        {} as any,
      )

      let refreshed = false
      globalThis.fetch = mock(async (url: any) => {
        if (String(url) === "https://auth.x.ai/oauth2/token") {
          refreshed = true
          return new Response(
            JSON.stringify({ access_token: "new", refresh_token: "rt-new", expires_in: 3600 }),
            { status: 200 },
          )
        }
        return new Response("{}", { status: 200 })
      }) as any

      await opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: {} })
      expect(refreshed).toBe(true)
      expect(setCalls).toHaveLength(1)
    })

    test("network failure during refresh surfaces the underlying fetch error to the caller", async () => {
      const { input } = makeInput()
      const hooks = await XaiAuthPlugin(input)
      const opts = await hooks.auth!.loader!(
        async () => ({ type: "oauth", access: "old", refresh: "rt", expires: 0 }),
        {} as any,
      )

      globalThis.fetch = mock(async () => {
        throw new TypeError("network down")
      }) as any

      await expect(opts.fetch!("https://api.x.ai/v1/chat/completions", { headers: {} })).rejects.toThrow(
        /network down/,
      )
    })
  })

  describe("device code flow (headless / VPS)", () => {
    const originalFetch = globalThis.fetch
    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    test("device-code authorize() advertises the verification URL + user code in the instructions and returns method=auto", async () => {
      // Regression: the headless flow must surface verification_uri AND
      // user_code so SSH users can complete the flow on any second device.
      globalThis.fetch = mock(async (url: any) => {
        if (String(url) === "https://auth.x.ai/oauth2/device/code") {
          return new Response(
            JSON.stringify({
              device_code: "DEVICE-1",
              user_code: "ABCD-1234",
              verification_uri: "https://x.ai/device",
              verification_uri_complete: "https://x.ai/device?user_code=ABCD-1234",
              expires_in: 600,
              interval: 5,
            }),
            { status: 200 },
          )
        }
        throw new Error(`unexpected fetch ${url}`)
      }) as any

      const hooks = await XaiAuthPlugin({} as any)
      const headless = hooks.auth!.methods.find(
        (m): m is Extract<typeof m, { type: "oauth" }> =>
          m.type === "oauth" && m.label === "xAI Grok OAuth (Headless / Remote / VPS)",
      )!
      expect(headless).toBeDefined()

      const result = await headless.authorize!()
      expect(result.method).toBe("auto")
      // browser URL prefers verification_uri_complete (already carries the
      // code, so the user doesn't have to type it on the same machine)…
      expect(result.url).toBe("https://x.ai/device?user_code=ABCD-1234")
      // …but the printed instructions must still reference the bare URL
      // so the user can open it on a phone and type the short code.
      expect(result.instructions).toContain("https://x.ai/device")
      expect(result.instructions).toContain("ABCD-1234")
    })

    test("device-code authorize() falls back to verification_uri when verification_uri_complete is absent", async () => {
      globalThis.fetch = mock(async () =>
        new Response(
          JSON.stringify({
            device_code: "DEVICE-2",
            user_code: "WXYZ-9876",
            verification_uri: "https://x.ai/device",
            expires_in: 600,
            interval: 5,
          }),
          { status: 200 },
        ),
      ) as any

      const hooks = await XaiAuthPlugin({} as any)
      const headless = hooks.auth!.methods.find(
        (m): m is Extract<typeof m, { type: "oauth" }> =>
          m.type === "oauth" && m.label === "xAI Grok OAuth (Headless / Remote / VPS)",
      )!
      const result = await headless.authorize!()
      expect(result.url).toBe("https://x.ai/device")
    })

    test("requestDeviceCode posts client_id + scope as form-encoded body and validates required fields", async () => {
      let capturedBody = ""
      globalThis.fetch = mock(async (url: any, init?: RequestInit) => {
        expect(String(url)).toBe("https://auth.x.ai/oauth2/device/code")
        expect(init?.method).toBe("POST")
        const headers = new Headers(init?.headers as HeadersInit)
        expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded")
        expect(headers.get("accept")).toBe("application/json")
        expect(headers.get("user-agent")).toMatch(/^opencode\//)
        capturedBody = String(init?.body)
        return new Response(
          JSON.stringify({
            device_code: "DC",
            user_code: "UC",
            verification_uri: "https://x.ai/device",
            interval: 5,
            expires_in: 600,
          }),
          { status: 200 },
        )
      }) as any

      await requestDeviceCode()
      const parsed = new URLSearchParams(capturedBody)
      expect(parsed.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828")
      // Scope must include offline_access; otherwise xAI will refuse to
      // issue a refresh_token and the user would be re-prompted on every
      // token expiry.
      expect(parsed.get("scope")).toContain("offline_access")
      expect(parsed.get("scope")).toContain("grok-cli:access")
      expect(parsed.get("scope")).toContain("api:access")
    })

    test("requestDeviceCode throws with HTTP status + body when the endpoint errors", async () => {
      globalThis.fetch = mock(async () => new Response("rate limited", { status: 429 })) as any
      await expect(requestDeviceCode()).rejects.toThrow(/xAI device code request failed \(429\).*rate limited/)
    })

    test("requestDeviceCode throws when response is missing required fields", async () => {
      globalThis.fetch = mock(async () => new Response(JSON.stringify({ device_code: "x" }), { status: 200 })) as any
      await expect(requestDeviceCode()).rejects.toThrow(/missing device_code \/ user_code \/ verification_uri/)
    })

    test("pollDeviceCodeToken resolves on the first OK response carrying tokens", async () => {
      let tokenCalls = 0
      globalThis.fetch = mock(async (url: any, init?: RequestInit) => {
        tokenCalls++
        expect(String(url)).toBe("https://auth.x.ai/oauth2/token")
        const headers = new Headers(init?.headers as HeadersInit)
        expect(headers.get("content-type")).toBe("application/x-www-form-urlencoded")
        expect(headers.get("accept")).toBe("application/json")
        expect(headers.get("user-agent")).toMatch(/^opencode\//)
        const body = new URLSearchParams(String(init?.body))
        expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code")
        expect(body.get("device_code")).toBe("DC-1")
        expect(body.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828")
        return new Response(
          JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 3600, token_type: "Bearer" }),
          { status: 200 },
        )
      }) as any

      const tokens = await pollDeviceCodeToken(
        {
          device_code: "DC-1",
          user_code: "UC",
          verification_uri: "https://x.ai/device",
          interval: 1,
          expires_in: 600,
        },
        { sleep: async () => {} },
      )
      expect(tokens.access_token).toBe("AT")
      expect(tokens.refresh_token).toBe("RT")
      expect(tokenCalls).toBe(1)
    })

    test("pollDeviceCodeToken honors authorization_pending and slow_down per RFC 8628", async () => {
      // First poll: authorization_pending → sleep interval, retry.
      // Second poll: slow_down → bump interval by +5s, sleep, retry.
      // Third poll: success.
      let n = 0
      globalThis.fetch = mock(async () => {
        n++
        if (n === 1) return new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 })
        if (n === 2) return new Response(JSON.stringify({ error: "slow_down" }), { status: 400 })
        return new Response(
          JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 3600 }),
          { status: 200 },
        )
      }) as any

      const sleeps: number[] = []
      const tokens = await pollDeviceCodeToken(
        {
          device_code: "DC",
          user_code: "UC",
          verification_uri: "https://x.ai/device",
          interval: 5, // 5s
          expires_in: 600,
        },
        { sleep: async (ms) => void sleeps.push(ms) },
      )
      expect(tokens.access_token).toBe("AT")
      expect(n).toBe(3)
      // Match Codex's polling behavior: base interval plus a small safety
      // margin, then slow_down bumps the interval by +5s before the margin.
      expect(sleeps).toEqual([8_000, 13_000])
    })

    test("pollDeviceCodeToken throws a friendly message on access_denied", async () => {
      globalThis.fetch = mock(async () => new Response(JSON.stringify({ error: "access_denied" }), { status: 400 })) as any
      await expect(
        pollDeviceCodeToken(
          { device_code: "DC", user_code: "UC", verification_uri: "https://x.ai/device", interval: 1, expires_in: 600 },
          { sleep: async () => {} },
        ),
      ).rejects.toThrow(/xAI device authorization was denied/)
    })

    test("pollDeviceCodeToken throws on expired_token", async () => {
      globalThis.fetch = mock(async () => new Response(JSON.stringify({ error: "expired_token" }), { status: 400 })) as any
      await expect(
        pollDeviceCodeToken(
          { device_code: "DC", user_code: "UC", verification_uri: "https://x.ai/device", interval: 1, expires_in: 600 },
          { sleep: async () => {} },
        ),
      ).rejects.toThrow(/device code expired/)
    })

    test("pollDeviceCodeToken surfaces unknown errors with status + description", async () => {
      globalThis.fetch = mock(
        async () =>
          new Response(JSON.stringify({ error: "server_error", error_description: "oops" }), { status: 500 }),
      ) as any
      await expect(
        pollDeviceCodeToken(
          { device_code: "DC", user_code: "UC", verification_uri: "https://x.ai/device", interval: 1, expires_in: 600 },
          { sleep: async () => {} },
        ),
      ).rejects.toThrow(/xAI device token exchange failed \(500\).*oops/)
    })

    test("pollDeviceCodeToken times out when the deadline passes without a terminal response", async () => {
      // Drive `now` so the deadline is passed on the second iteration check.
      globalThis.fetch = mock(
        async () => new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 }),
      ) as any
      let tick = 0
      const start = 1_000_000
      await expect(
        pollDeviceCodeToken(
          {
            device_code: "DC",
            user_code: "UC",
            verification_uri: "https://x.ai/device",
            interval: 1,
            expires_in: 1, // 1s window
          },
          {
            sleep: async () => {},
            now: () => start + tick++ * 600, // 0ms, 600ms, 1200ms → 3rd check is past 1000ms deadline
          },
        ),
      ).rejects.toThrow(/xAI device authorization timed out/)
    })

    test("pollDeviceCodeToken falls back to the default interval (and floors it) when the server sends 0, so we don't busy-loop the token endpoint", async () => {
      let n = 0
      globalThis.fetch = mock(async () => {
        n++
        if (n === 1) return new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 })
        return new Response(JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 3600 }), {
          status: 200,
        })
      }) as any

      const sleeps: number[] = []
      await pollDeviceCodeToken(
        {
          device_code: "DC",
          user_code: "UC",
          verification_uri: "https://x.ai/device",
          interval: 0, // 0 is non-positive → use default interval (5s)
          expires_in: 600,
        },
        { sleep: async (ms) => void sleeps.push(ms) },
      )
      // 5s default interval + 3s safety margin. Exact assertion (not >=) so
      // a regression that drops either the default-fallback OR the safety
      // margin OR the >0 check would be caught.
      expect(sleeps[0]).toBe(8_000)
    })

    test("pollDeviceCodeToken treats garbage interval values (NaN, string, negative) as missing and uses the default — defends against malformed token endpoint responses busy-looping the polling loop", async () => {
      // Regression guard for the M2 parity fix: `device.interval ?? default`
      // would let `NaN` through (typeof NaN === "number"), reaching
      // `setTimeout(_, NaN)` which Node treats as 0ms → busy-loop until the
      // device-code deadline (~10 minutes). The fix normalizes via
      // `Number.isFinite(x) && x > 0` so all of the bad shapes below collapse
      // to the default interval.
      const badIntervals: Array<unknown> = [Number.NaN, "NaN", "garbage", -5, null]
      for (const bad of badIntervals) {
        let n = 0
        globalThis.fetch = mock(async () => {
          n++
          if (n === 1) return new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 })
          return new Response(JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 3600 }), {
            status: 200,
          })
        }) as any

        const sleeps: number[] = []
        await pollDeviceCodeToken(
          {
            device_code: "DC",
            user_code: "UC",
            verification_uri: "https://x.ai/device",
            interval: bad as number,
            expires_in: 600,
          },
          { sleep: async (ms) => void sleeps.push(ms) },
        )
        expect(sleeps[0]).toBe(8_000)
      }
    })

    test("pollDeviceCodeToken applies the same defensive normalization to expires_in so a NaN deadline doesn't make `now() < deadline` always-false (instant timeout) or always-true (infinite loop)", async () => {
      const badExpires: Array<unknown> = [Number.NaN, "NaN", "garbage", -5, null, 0]
      for (const bad of badExpires) {
        // Resolve on first call so we don't actually wait the default 5-min
        // window — we're only proving the deadline math doesn't explode.
        globalThis.fetch = mock(
          async () =>
            new Response(JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 3600 }), {
              status: 200,
            }),
        ) as any
        const tokens = await pollDeviceCodeToken(
          {
            device_code: "DC",
            user_code: "UC",
            verification_uri: "https://x.ai/device",
            interval: 1,
            expires_in: bad as number,
          },
          { sleep: async () => {} },
        )
        expect(tokens.access_token).toBe("AT")
      }
    })

    test("device-code authorize().callback() returns success with refresh + access + expires on a happy path", async () => {
      // End-to-end through the public plugin surface: authorize() obtains
      // a device code, callback() polls once and resolves with tokens.
      let stage: "device" | "token" = "device"
      globalThis.fetch = mock(async (url: any) => {
        if (String(url) === "https://auth.x.ai/oauth2/device/code" && stage === "device") {
          stage = "token"
          return new Response(
            JSON.stringify({
              device_code: "DC",
              user_code: "UC",
              verification_uri: "https://x.ai/device",
              interval: 0,
              expires_in: 600,
            }),
            { status: 200 },
          )
        }
        if (String(url) === "https://auth.x.ai/oauth2/token") {
          return new Response(
            JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 3600 }),
            { status: 200 },
          )
        }
        throw new Error(`unexpected fetch ${url}`)
      }) as any

      const hooks = await XaiAuthPlugin({} as any)
      const headless = hooks.auth!.methods.find(
        (m): m is Extract<typeof m, { type: "oauth" }> =>
          m.type === "oauth" && m.label === "xAI Grok OAuth (Headless / Remote / VPS)",
      )!
      const result = await headless.authorize!()
      const callbackResult = await (result as any).callback()
      expect(callbackResult.type).toBe("success")
      expect(callbackResult.refresh).toBe("RT")
      expect(callbackResult.access).toBe("AT")
      expect(callbackResult.expires).toBeGreaterThan(Date.now())
    })

    test("device-code authorize().callback() returns failed (not throws) when polling errors so the CLI can show a clean message", async () => {
      let stage: "device" | "token" = "device"
      globalThis.fetch = mock(async (url: any) => {
        if (String(url) === "https://auth.x.ai/oauth2/device/code" && stage === "device") {
          stage = "token"
          return new Response(
            JSON.stringify({
              device_code: "DC",
              user_code: "UC",
              verification_uri: "https://x.ai/device",
              interval: 0,
              expires_in: 600,
            }),
            { status: 200 },
          )
        }
        return new Response(JSON.stringify({ error: "access_denied" }), { status: 400 })
      }) as any

      const hooks = await XaiAuthPlugin({} as any)
      const headless = hooks.auth!.methods.find(
        (m): m is Extract<typeof m, { type: "oauth" }> =>
          m.type === "oauth" && m.label === "xAI Grok OAuth (Headless / Remote / VPS)",
      )!
      const result = await headless.authorize!()
      expect(await (result as any).callback()).toEqual({ type: "failed" })
    })
  })

  describe("methods registration", () => {
    test("plugin advertises all three methods in the documented order: browser OAuth, headless device-code, API key", async () => {
      // Order matters — opencode renders the methods in this order in the
      // auth picker, so headless users see the device-code option without
      // having to scroll past the API-key fallback.
      const hooks = await XaiAuthPlugin({} as any)
      const labels = hooks.auth!.methods.map((m) => m.label)
      expect(labels).toEqual([
        "xAI Grok OAuth (SuperGrok Subscription)",
        "xAI Grok OAuth (Headless / Remote / VPS)",
        "Manually enter API Key",
      ])
      expect(hooks.auth!.methods.map((m) => m.type)).toEqual(["oauth", "oauth", "api"])
    })
  })
})

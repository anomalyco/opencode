import { describe, expect, it } from "bun:test"
import { createSsoFetch, renewSessionToken, initiateExternalBrowserAuth } from "../../src/provider/snowflake/externalbrowser"
import type { FetchLike } from "../../src/provider/snowflake/externalbrowser"

describe("renewSessionToken", () => {
  it("POSTs to token-request with correct Authorization header and body", async () => {
    const captured: { url: string; init: RequestInit }[] = []
    const fakeFetch: FetchLike = async (url, init) => {
      captured.push({ url: String(url), init: init ?? {} })
      return new Response(JSON.stringify({ data: { sessionToken: "new-token", validityInSecondsST: 3600 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    const before = Date.now()
    const result = await renewSessionToken("myaccount", "old-session", "master-token", fakeFetch)
    const after = Date.now()

    expect(captured).toHaveLength(1)
    expect(captured[0].url).toMatch(/^https:\/\/myaccount\.snowflakecomputing\.com\/session\/token-request/)
    expect(captured[0].init.method).toBe("POST")

    const headers = new Headers(captured[0].init.headers as HeadersInit)
    expect(headers.get("Authorization")).toBe('Snowflake Token="master-token"')

    const body = JSON.parse(captured[0].init.body as string)
    expect(body.data.REQUEST_TYPE).toBe("RENEW")
    expect(body.data.oldSessionToken).toBe("old-session")
    expect(body.data.masterToken).toBe("master-token")

    expect(result.session_token).toBe("new-token")
    expect(result.session_expires).toBeGreaterThanOrEqual(before + 3600 * 1000)
    expect(result.session_expires).toBeLessThanOrEqual(after + 3600 * 1000)
  })
})

describe("createSsoFetch", () => {
  it("injects Authorization: Snowflake Token header on a non-expired session", async () => {
    const captured: RequestInit[] = []
    const fakeFetch: FetchLike = async (_url, init) => {
      captured.push(init ?? {})
      return new Response("{}", { status: 200 })
    }

    const ssoFetch = createSsoFetch({
      account: "myaccount",
      session: {
        session_token: "active-session",
        master_token: "master",
        session_expires: Date.now() + 10 * 60 * 1000,
        master_expires: Date.now() + 4 * 60 * 60 * 1000,
      },
      fetchImpl: fakeFetch,
    })

    await ssoFetch("https://example.com/api", { method: "POST" })

    expect(captured).toHaveLength(1)
    const headers = new Headers(captured[0].headers as HeadersInit)
    expect(headers.get("Authorization")).toBe('Snowflake Token="active-session"')
  })

  it("triggers renewal exactly once when session_expires is within the 60s buffer", async () => {
    let renewCalls = 0
    const onRenewCaptures: Array<{ session_token: string; session_expires: number }> = []
    const fakeRenewFn = async (
      _account: string,
      _sessionToken: string,
      _masterToken: string,
    ): Promise<{ session_token: string; session_expires: number }> => {
      renewCalls++
      return { session_token: "renewed-token", session_expires: Date.now() + 3600 * 1000 }
    }

    const authHeaders: string[] = []
    const fakeFetch: FetchLike = async (_url, init) => {
      const headers = new Headers(init?.headers as HeadersInit)
      authHeaders.push(headers.get("Authorization") ?? "")
      return new Response("{}", { status: 200 })
    }

    const ssoFetch = createSsoFetch({
      account: "myaccount",
      session: {
        session_token: "old-session",
        master_token: "master",
        session_expires: Date.now() + 30 * 1000, // within 60s buffer
        master_expires: Date.now() + 4 * 60 * 60 * 1000,
      },
      renewFn: fakeRenewFn,
      fetchImpl: fakeFetch,
      onRenew: (s) => onRenewCaptures.push(s),
    })

    await ssoFetch("https://example.com/api", {})

    expect(renewCalls).toBe(1)
    expect(authHeaders[0]).toBe('Snowflake Token="renewed-token"')
    expect(onRenewCaptures).toHaveLength(1)
    expect(onRenewCaptures[0].session_token).toBe("renewed-token")
  })

  it("single-flights renewal: 5 concurrent calls with expiring session call renewFn exactly once", async () => {
    let renewCalls = 0
    const fakeRenewFn = async (
      _account: string,
      _sessionToken: string,
      _masterToken: string,
    ): Promise<{ session_token: string; session_expires: number }> => {
      renewCalls++
      // small delay so concurrent calls pile up
      await new Promise<void>((r) => setTimeout(r, 20))
      return { session_token: "renewed", session_expires: Date.now() + 3600 * 1000 }
    }

    const fakeFetch: FetchLike = async () => new Response("{}", { status: 200 })

    const ssoFetch = createSsoFetch({
      account: "myaccount",
      session: {
        session_token: "old",
        master_token: "master",
        session_expires: Date.now() + 30 * 1000, // within 60s buffer
        master_expires: Date.now() + 4 * 60 * 60 * 1000,
      },
      renewFn: fakeRenewFn,
      fetchImpl: fakeFetch,
    })

    await Promise.all(Array.from({ length: 5 }, () => ssoFetch("https://example.com", {})))

    expect(renewCalls).toBe(1)
  })

  it("throws a clear re-auth error when master_expires is in the past", async () => {
    const ssoFetch = createSsoFetch({
      account: "myaccount",
      session: {
        session_token: "expired-session",
        master_token: "expired-master",
        session_expires: Date.now() - 1000,
        master_expires: Date.now() - 1000,
      },
    })

    await expect(ssoFetch("https://example.com", {})).rejects.toThrow(/re-authenticate/)
  })
})

describe("sanitizeAccount integration", () => {
  it("sanitizes account strings with protocols and trailing slashes in renewSessionToken", async () => {
    const captured: string[] = []
    const fakeFetch: FetchLike = async (url) => {
      captured.push(String(url))
      return new Response(JSON.stringify({ data: { sessionToken: "new-token", validityInSecondsST: 3600 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    await renewSessionToken("https://myaccount.snowflakecomputing.com/", "old-session", "master-token", fakeFetch)
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatch(/^https:\/\/myaccount\.snowflakecomputing\.com\/session\/token-request/)
  })
})

describe("startLoopback error handling", () => {
  it("ignores malformed request URLs without crashing, responds with 400, and successfully processes subsequent valid requests", async () => {
    let capturedPort = 0
    const fakeFetch: FetchLike = async (url, init) => {
      const urlStr = String(url)
      if (urlStr.includes("authenticator-request")) {
        if (init?.body) {
          const body = JSON.parse(init.body as string)
          capturedPort = Number(body.data.BROWSER_MODE_REDIRECT_PORT)
        }
        return new Response(JSON.stringify({ data: { ssoUrl: "https://sso.example.com", proofKey: "proof" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      } else if (urlStr.includes("login-request")) {
        return new Response(JSON.stringify({
          data: {
            token: "my-session-token",
            masterToken: "my-master-token",
            validityInSeconds: 3600,
            masterValidityInSeconds: 14400,
          }
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      return new Response("{}", { status: 404 })
    }

    // Override global.URL to simulate URL constructor throwing TypeError on malformed URLs
    const OriginalURL = global.URL
    let urlConstructorCalls = 0
    global.URL = class extends OriginalURL {
      constructor(url: string | URL, base?: string | URL) {
        urlConstructorCalls++
        if (typeof url === "string" && url.includes("malformed")) {
          throw new TypeError("Invalid URL")
        }
        super(url, base)
      }
    } as any

    try {
      const { callback } = await initiateExternalBrowserAuth("myaccount", fakeFetch)
      expect(capturedPort).toBeGreaterThan(0)

      // Send malformed request that causes URL to throw
      const malformedRes = await fetch(`http://127.0.0.1:${capturedPort}/malformed`)
      expect(malformedRes.status).toBe(400)
      const malformedText = await malformedRes.text()
      expect(malformedText).toBe("Invalid URL")

      // Send a second request that is missing the token parameter
      const missingRes = await fetch(`http://127.0.0.1:${capturedPort}/`)
      expect(missingRes.status).toBe(400)
      const missingText = await missingRes.text()
      expect(missingText).toBe("Missing token parameter")

      // Send a third request that is valid
      const validRes = await fetch(`http://127.0.0.1:${capturedPort}/?token=my-secret-idp-token`)
      expect(validRes.status).toBe(200)
      const validText = await validRes.text()
      expect(validText).toContain("Authentication complete")

      // Await the callback to ensure it received the token and completed successfully
      const result = await callback()
      expect(result.session_token).toBe("my-session-token")
      expect(result.master_token).toBe("my-master-token")
    } finally {
      global.URL = OriginalURL
    }
  })
})


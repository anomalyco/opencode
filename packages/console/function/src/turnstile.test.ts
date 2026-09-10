import { describe, expect, test } from "bun:test"
import { getTurnstileProvider, getTurnstileProviderRequest, renderTurnstilePage, verifyTurnstile } from "./turnstile"

describe("Turnstile verification", () => {
  test("verifies the action, hostname, and source IP", async () => {
    const requests: Request[] = []
    const verified = await verifyTurnstile(
      {
        token: "challenge-token",
        secret: "secret",
        hostname: "auth.dev.opencode.ai",
        remoteIP: "203.0.113.10",
      },
      (input, init) => {
        requests.push(new Request(input, init))
        return Promise.resolve(
          Response.json({
            success: true,
            action: "legacy_console_auth",
            hostname: "auth.dev.opencode.ai",
          }),
        )
      },
    )

    expect(verified).toBe(true)
    const body = await requests[0].formData()
    expect(body.get("response")).toBe("challenge-token")
    expect(body.get("secret")).toBe("secret")
    expect(body.get("remoteip")).toBe("203.0.113.10")
    expect(body.get("idempotency_key")).toBeString()
  })

  test("rejects missing tokens and mismatched verification context", async () => {
    const fetcher = () =>
      Promise.resolve(
        Response.json({
          success: true,
          action: "other_action",
          hostname: "auth.dev.opencode.ai",
        }),
      )

    expect(
      await verifyTurnstile({ token: "", secret: "secret", hostname: "auth.dev.opencode.ai" }, () =>
        Promise.reject(new Error("should not fetch")),
      ),
    ).toBe(false)
    expect(
      await verifyTurnstile({ token: "challenge-token", secret: "secret", hostname: "auth.dev.opencode.ai" }, fetcher),
    ).toBe(false)
  })

  test("fails closed when Cloudflare is unavailable", async () => {
    expect(
      await verifyTurnstile({ token: "challenge-token", secret: "secret", hostname: "auth.dev.opencode.ai" }, () =>
        Promise.reject(new Error("unavailable")),
      ),
    ).toBe(false)
  })
})

describe("Turnstile routing", () => {
  test("recognizes only provider authorization routes", () => {
    expect(getTurnstileProvider("/github/authorize")).toBe("github")
    expect(getTurnstileProvider("/google/authorize/")).toBe("google")
    expect(getTurnstileProvider("/github/callback")).toBeUndefined()
    expect(getTurnstileProvider("/authorize")).toBeUndefined()
  })

  test("routes verified challenges directly to the provider", () => {
    const request = new Request("https://auth.dev.opencode.ai/turnstile", {
      method: "POST",
      headers: {
        Cookie: "openauth=state",
        "Content-Type": "application/x-www-form-urlencoded",
      },
    })
    const routed = getTurnstileProviderRequest(request, "github")
    expect(routed.method).toBe("GET")
    expect(routed.url).toBe("https://auth.dev.opencode.ai/github/authorize")
    expect(routed.headers.get("Cookie")).toBe("openauth=state")
    expect(routed.headers.has("Content-Type")).toBe(false)
  })

  test("renders a no-store interaction-only challenge", async () => {
    const response = renderTurnstilePage("site-key", ["github"])
    const body = await response.text()
    expect(response.headers.get("Cache-Control")).toBe("no-store")
    expect(body).toContain('data-sitekey="site-key"')
    expect(body).toContain('data-action="legacy_console_auth"')
    expect(body).toContain('data-appearance="interaction-only"')
    expect(body).toContain('value="github"')
    expect(body).not.toContain('value="google"')
  })
})

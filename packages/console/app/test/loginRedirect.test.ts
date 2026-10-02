import { describe, expect, test } from "bun:test"
import { continuePath, loginUrl } from "../src/lib/login-redirect"

describe("continue path", () => {
  test("accepts same-origin page paths", () => {
    expect(continuePath("/workspace/wrk_123/go")).toBe("/workspace/wrk_123/go")
    expect(continuePath("/")).toBe("/")
  })

  test("rejects values that could leave the origin or the login flow", () => {
    const values = [
      undefined,
      null,
      "",
      "workspace/wrk_123",
      "//evil.example/phishing",
      "/\\evil.example",
      "https://evil.example/",
      "/workspace/wrk_123?x=1",
      "/workspace/wrk_123#x",
      "/workspace/wrk 123",
      "/auth",
      "/auth/authorize",
    ]

    expect(values.map(continuePath)).toEqual(values.map(() => undefined))
  })
})

describe("login url", () => {
  test("returns to the requested page after login", () => {
    expect(loginUrl(new Request("https://opencode.ai/workspace/wrk_123/go"))).toBe(
      "https://opencode.ai/auth/authorize?continue=%2Fworkspace%2Fwrk_123%2Fgo",
    )
  })

  test("returns to the page that called a server function", () => {
    expect(
      loginUrl(
        new Request("https://opencode.ai/_server?id=go.referral.get", {
          method: "POST",
          headers: { referer: "https://opencode.ai/workspace/wrk_123/go" },
        }),
      ),
    ).toBe("https://opencode.ai/auth/authorize?continue=%2Fworkspace%2Fwrk_123%2Fgo")
  })

  test("drops unusable return locations", () => {
    const referers = ["https://evil.example/workspace/wrk_123", "not a url", undefined]

    expect(
      referers.map((referer) =>
        loginUrl(
          new Request("https://opencode.ai/_server?id=go.referral.get", {
            method: "POST",
            headers: referer === undefined ? undefined : { referer },
          }),
        ),
      ),
    ).toEqual(Array(referers.length).fill("https://opencode.ai/auth/authorize"))
    expect(loginUrl(new Request("https://opencode.ai/auth"))).toBe("https://opencode.ai/auth/authorize")
  })
})

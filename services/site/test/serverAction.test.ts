import { describe, expect, test } from "bun:test"
import { sanitizeServerActionRequest } from "../src/lib/server-action"

describe("server action referer", () => {
  test("preserves same-origin return locations", () => {
    const request = new Request("https://dev.opencode.ai/_server?id=action", {
      headers: { referer: "https://dev.opencode.ai/auth?next=%2Fconsole" },
    })

    expect(sanitizeServerActionRequest(request)).toBe(request)
  })

  test("replaces unsafe return locations with the request origin", () => {
    const referers = ["https://evil.example/phishing-login", "not a url", undefined]

    expect(
      referers.map((referer) =>
        sanitizeServerActionRequest(
          new Request("https://dev.opencode.ai/_server?id=action", {
            headers: referer === undefined ? undefined : { referer },
          }),
        ).headers.get("referer"),
      ),
    ).toEqual(["https://dev.opencode.ai", "https://dev.opencode.ai", "https://dev.opencode.ai"])
  })

  test("keeps the method and body when it replaces the referer", async () => {
    const sanitized = sanitizeServerActionRequest(
      new Request("https://dev.opencode.ai/_server?id=action", {
        method: "POST",
        headers: { referer: "https://evil.example/phishing-login" },
        body: "[1]",
      }),
    )

    expect([sanitized.method, sanitized.headers.get("referer"), await sanitized.text()]).toEqual([
      "POST",
      "https://dev.opencode.ai",
      "[1]",
    ])
  })

  test("drops the body of a GET it rebuilds", () => {
    const request = {
      url: "https://dev.opencode.ai/_server?id=action",
      method: "GET",
      headers: new Headers({ referer: "https://evil.example/phishing-login" }),
      body: new Response("[1]").body,
    } as unknown as Request

    expect(sanitizeServerActionRequest(request).body).toBeNull()
  })

  test("does not change other routes", () => {
    const request = new Request("https://dev.opencode.ai/auth", {
      headers: { referer: "https://evil.example/phishing-login" },
    })

    expect(sanitizeServerActionRequest(request)).toBe(request)
  })
})

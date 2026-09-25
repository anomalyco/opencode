import { describe, expect, test } from "bun:test"
import { sessionDeepLink } from "./session-deep-link"

describe("sessionDeepLink", () => {
  test("builds a deep link with base64url-encoded server address", () => {
    expect(sessionDeepLink("http://127.0.0.1:38245", "ses_x")).toBe(
      "http://127.0.0.1:38245/server/aHR0cDovLzEyNy4wLjAuMTozODI0NQ/session/ses_x",
    )
  })

  test("encodes the server address without padding", () => {
    expect(sessionDeepLink("http://localhost:9009", "ses_y")).toContain("aHR0cDovL2xvY2FsaG9zdDo5MDA5")
  })

  test("normalizes a trailing slash on the server address", () => {
    expect(sessionDeepLink("http://127.0.0.1:4096/", "ses_x")).toBe(
      "http://127.0.0.1:4096/server/aHR0cDovLzEyNy4wLjAuMTo0MDk2/session/ses_x",
    )
  })
})
import { describe, expect, mock, test } from "bun:test"

mock.module("electron-log/main.js", () => ({
  default: {
    transports: {
      console: { level: "info", writeFn() {} },
      file: { maxSize: 0, getFile: () => ({ path: "test.log" }) },
    },
  },
}))

const { redactSensitiveBrowserText, redactSensitiveBrowserUrl } = await import("./logging")

describe("logging redaction helpers", () => {
  test("redactSensitiveBrowserText removes auth headers, cookies, and token-like values", () => {
    expect(
      redactSensitiveBrowserText(
        "Authorization: Bearer secret-token Cookie: session=abc123 access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature keep-this",
      ),
    ).toBe("Authorization: [REDACTED] Cookie: [REDACTED] access_token=[REDACTED] keep-this")
  })

  test("redactSensitiveBrowserUrl removes sensitive query, hash, and userinfo values", () => {
    expect(
      redactSensitiveBrowserUrl(
        "https://user:pass@example.com/path?token=abc123&tab=security#access_token=def456&mode=done",
      ),
    ).toBe(
      "https://%5BREDACTED%5D:%5BREDACTED%5D@example.com/path?token=%5BREDACTED%5D&tab=security#access_token=%5BREDACTED%5D&mode=done",
    )
  })
})

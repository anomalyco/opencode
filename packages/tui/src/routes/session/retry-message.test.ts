import { describe, expect, test } from "bun:test"
import { boundRetryMessage, isHtmlDocument } from "./retry-message"

const nginx503 = `<html>
<head><title>503 Service Temporarily Unavailable</title></head>
<body>
<center><h1>503 Service Temporarily Unavailable</h1></center>
<hr><center>nginx</center>
</body>
</html>`

describe("tui session retry-message", () => {
  test("bounds html body from provider 503", () => {
    expect(
      boundRetryMessage({
        message: `Provider request failed with HTTP 503: ${nginx503}`,
        status: 503,
      }),
    ).toBe("Provider temporarily unavailable (HTTP 503)")
  })

  test("bounds html body without status", () => {
    expect(boundRetryMessage({ message: nginx503 })).toBe("Provider request failed")
  })

  test("bounds html body for 4xx status", () => {
    expect(boundRetryMessage({ message: `<html><body>nope</body></html>`, status: 418 })).toBe(
      "Provider request failed (HTTP 418)",
    )
  })

  test("detects html documents with doctype or leading tag", () => {
    expect(isHtmlDocument("<!DOCTYPE html><html></html>")).toBe(true)
    expect(isHtmlDocument("<head><title>x</title></head>")).toBe(true)
    expect(isHtmlDocument("plain <b>bold</b> text")).toBe(false)
  })

  test("passes plain messages through untouched", () => {
    const message = "Provider request failed with HTTP 429: rate limit exceeded"
    expect(boundRetryMessage({ message, status: 429 })).toBe(message)
  })

  test("handles non-string messages defensively", () => {
    // @ts-expect-error defensive runtime guard
    expect(boundRetryMessage({ message: undefined })).toBe("")
  })
})

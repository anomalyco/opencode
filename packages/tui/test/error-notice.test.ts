import { expect, test } from "bun:test"
import { noticeText } from "../src/util/error-notice"

test("keeps a plain message", () => {
  expect(noticeText("Provider is temporarily unavailable")).toBe("Provider is temporarily unavailable")
})

test("reduces an nginx 503 page to its title", () => {
  const page = `<!DOCTYPE html>
<html>
<head><title>503 Service Temporarily Unavailable</title></head>
<body>
<center><h1>503 Service Temporarily Unavailable</h1></center>
<hr><center>nginx</center>
</body>
</html>`
  expect(noticeText(page)).toBe("503 Service Temporarily Unavailable")
})

test("falls back to the first heading when the page has no title", () => {
  const page = `<html><body><h1>Bad Gateway</h1><p>upstream timed out</p></body></html>`
  expect(noticeText(page)).toBe("Bad Gateway")
})

test("strips markup and decodes entities", () => {
  expect(noticeText(`<p>Request failed &amp; retried</p>`)).toBe("Request failed & retried")
})

test("collapses whitespace into one line", () => {
  expect(noticeText("line one\n\n   line two\tline three")).toBe("line one line two line three")
})

test("truncates long messages", () => {
  const text = noticeText("x".repeat(500), 40)
  expect(text.length).toBe(40)
  expect(text.endsWith("…")).toBe(true)
})

test("uses a fallback for empty input", () => {
  expect(noticeText(undefined)).toBe("provider error")
  expect(noticeText("   ")).toBe("provider error")
  expect(noticeText("<html><body></body></html>")).toBe("provider error")
})

import { expect, test } from "bun:test"
import { navigationNotice } from "./refusal-notice"

test("refusals describe the actual destination without displaying private, misleading or unbounded targets", () => {
  expect(navigationNotice("mailto:fixture@example.invalid", {})).toEqual({
    reason: "external",
    target: "mailto:fixture@example.invalid",
  })
  expect(navigationNotice("https://name:secret@example.invalid", {})).toEqual({ reason: "browser.address.credentials" })

  for (const url of [
    "file:///etc/passwd",
    "oc-preview://private/secret",
    "javascript:noop()",
    "slack://user:password@host",
    "slack://abc\n",
    "tel:12\u202e34",
    `sms:${"x".repeat(2048)}`,
  ]) {
    expect(navigationNotice(url, { fileRoots: ["/workspace"] })).toEqual({ reason: "browser.address.workspace" })
    expect(navigationNotice(url, {})).toEqual({ reason: "browser.address.web" })
  }
})

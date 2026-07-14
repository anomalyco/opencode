import { describe, expect, test } from "bun:test"
import { isSafeExternalLink } from "./external-link"

describe("external link", () => {
  test("allows http and https links", () => {
    expect(isSafeExternalLink("https://opencode.ai")).toBe(true)
    expect(isSafeExternalLink("http://localhost:3000")).toBe(true)
  })

  test("blocks non-http protocols", () => {
    expect(isSafeExternalLink("file:///tmp/demo.txt")).toBe(false)
    expect(isSafeExternalLink("javascript:alert(1)")).toBe(false)
    expect(isSafeExternalLink("smb://attacker/share")).toBe(false)
    expect(isSafeExternalLink("ms-msdt:/id PCWDiagnostic")).toBe(false)
  })

  test("blocks malformed links", () => {
    expect(isSafeExternalLink("not a url")).toBe(false)
    expect(isSafeExternalLink("/relative/path")).toBe(false)
    expect(isSafeExternalLink("")).toBe(false)
  })
})

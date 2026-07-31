import { describe, expect, test } from "bun:test"
import { safeExternalUrl } from "./external-link"

describe("safeExternalUrl", () => {
  test("allows web links", () => {
    expect(safeExternalUrl("https://opencode.ai/docs")).toBe("https://opencode.ai/docs")
    expect(safeExternalUrl("http://localhost:3000/callback")).toBe("http://localhost:3000/callback")
  })

  test("rejects executable and application protocols", () => {
    expect(safeExternalUrl("file:///tmp/script.sh")).toBeUndefined()
    expect(safeExternalUrl("ssh://attacker.example")).toBeUndefined()
    expect(safeExternalUrl("custom-handler:payload")).toBeUndefined()
  })

  test("rejects malformed URLs", () => {
    expect(safeExternalUrl("not a url")).toBeUndefined()
  })
})

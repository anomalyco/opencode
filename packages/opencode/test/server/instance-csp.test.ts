import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { themePreloadScriptHash } from "../../src/server/instance"

describe("instance web csp", () => {
  test("hashes the inline theme preload script", () => {
    const html = `<html><script id="oc-theme-preload-script">console.log("x")</script></html>`
    const hash = createHash("sha256").update(`console.log("x")`).digest("base64")
    expect(themePreloadScriptHash(html)).toBe(hash)
  })

  test("embedded html path uses the hashed csp", async () => {
    const src = await Bun.file(new URL("../../src/server/instance.ts", import.meta.url)).text()
    expect(src).toContain(`c.header("Content-Security-Policy", csp(themePreloadScriptHash(html)))`)
    expect(src).not.toContain(`c.header("Content-Security-Policy", DEFAULT_CSP)`)
  })
})

import { describe, expect, test } from "bun:test"
import { createRequire } from "module"

const require = createRequire(import.meta.url)

describe("build dependencies", () => {
  test("resolves Bun compile chromium-bidi submodules used by Playwright", () => {
    expect(require.resolve("chromium-bidi/lib/cjs/bidiMapper/BidiMapper")).toBeTruthy()
    expect(require.resolve("chromium-bidi/lib/cjs/cdp/CdpConnection")).toBeTruthy()
  })
})

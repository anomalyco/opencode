import { describe, expect, test } from "bun:test"
import { allowsGoBalanceFallback } from "../src/routes/zen/util/goBalanceFallback"

describe("Go balance fallback", () => {
  test("allows an active subscriber who enabled Use balance", () => {
    expect(allowsGoBalanceFallback({ useBalance: true })).toBe(true)
  })

  test("rejects an active subscriber who did not enable Use balance", () => {
    expect(allowsGoBalanceFallback({})).toBe(false)
  })

  test("rejects a workspace whose Go subscription has ended", () => {
    expect(allowsGoBalanceFallback(null)).toBe(false)
  })
})

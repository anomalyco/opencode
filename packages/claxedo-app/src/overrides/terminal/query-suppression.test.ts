import { describe, expect, test } from "bun:test"
import { createQuerySuppressor } from "./query-suppression"

describe("query suppression", () => {
  test("csi_R_is_suppressed", () => {
    const suppress = createQuerySuppressor()
    const out = suppress.scan("a\u001b[12;34Rb")
    expect(out).toBe("ab")
  })

  test("csi_c_not_suppressed", () => {
    const suppress = createQuerySuppressor()
    const out = suppress.scan("a\u001b[cb")
    expect(out).toBe("a\u001b[cb")
  })

  test("csi_t_not_suppressed", () => {
    const suppress = createQuerySuppressor()
    const out = suppress.scan("a\u001b[22;0tb")
    expect(out).toBe("a\u001b[22;0tb")
  })

  test("cpr_split_across_chunks_is_suppressed", () => {
    const suppress = createQuerySuppressor()
    const first = suppress.scan("prefix\u001b[12;")
    const second = suppress.scan("34Rtail")
    expect(first).toBe("prefix")
    expect(second).toBe("tail")
  })

  test("csi_dollar_y_is_suppressed", () => {
    const suppress = createQuerySuppressor()
    const out = suppress.scan("a\u001b[?2004;1$yb")
    expect(out).toBe("ab")
  })

  test("csi_dollar_y_split_across_chunks_is_suppressed", () => {
    const suppress = createQuerySuppressor()
    const first = suppress.scan("x\u001b[?2004;")
    const second = suppress.scan("1$yy")
    expect(first).toBe("x")
    expect(second).toBe("y")
  })
})

import { describe, expect, test } from "bun:test"
import { footerWidthPolicy } from "../../src/mini/footer.width"

describe("run footer width", () => {
  test("preserves the dialog breakpoint", () => {
    expect(footerWidthPolicy(79).dialog.narrow).toBe(true)
    expect(footerWidthPolicy(80).dialog.narrow).toBe(false)
  })
})

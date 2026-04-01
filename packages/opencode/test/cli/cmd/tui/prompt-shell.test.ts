import { describe, expect, test } from "bun:test"
import { shellAction } from "../../../../src/cli/cmd/tui/component/prompt/shell"

describe("prompt shell mode", () => {
  test("consumes tab so it does not bubble to global agent cycle", () => {
    expect(shellAction("tab", 3)).toBe("consume")
  })

  test("backspace at the start exits shell mode", () => {
    expect(shellAction("backspace", 0)).toBe("normal")
  })

  test("escape exits shell mode", () => {
    expect(shellAction("escape", 3)).toBe("normal")
  })

  test("backspace away from the start stays in shell mode", () => {
    expect(shellAction("backspace", 2)).toBeUndefined()
  })
})

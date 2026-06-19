import { describe, expect, test } from "bun:test"
import { openBrowser } from "../../src/cli/cmd/web"

describe("cli web", () => {
  test("ignores browser opener failures", async () => {
    expect(() => {
      openBrowser("http://127.0.0.1:55555", () => {
        throw new Error("spawn failed")
      })
    }).not.toThrow()

    await expect(
      openBrowser("http://127.0.0.1:55555", () => Promise.reject(new Error("spawn failed"))),
    ).resolves.toBeUndefined()
  })
})

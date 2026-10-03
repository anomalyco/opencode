import { describe, expect, test } from "bun:test"
import { resolveProviderIcon } from "./provider-icon"
import { iconNames } from "./provider-icons/types"

describe("resolveProviderIcon", () => {
  test.each(["kimi-code-plan-cn", "kimi-code-plan-global"])("maps %s to the existing Kimi artwork", (id) => {
    expect(resolveProviderIcon(id)).toBe("kimi-for-coding")
  })

  test("preserves every registered provider icon, including the legacy Kimi ID", () => {
    for (const id of iconNames) {
      expect(resolveProviderIcon(id)).toBe(id)
    }
  })

  test.each(["unknown-provider", "", "kimi-code-plan", "kimi-code-plan-other"])("falls back for %j", (id) => {
    expect(resolveProviderIcon(id)).toBe("synthetic")
  })

  test("the Kimi artwork exists in the sprite", async () => {
    const sprite = await Bun.file(new URL("./provider-icons/sprite.svg", import.meta.url)).text()
    expect(sprite).toMatch(/<symbol\b[^>]*\bid="kimi-for-coding"/)
  })
})

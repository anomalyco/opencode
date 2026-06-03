import { describe, expect, test } from "bun:test"
import nordThemeJson from "./themes/nord.json"
import { resolveThemeVariantV2 } from "./resolve-v2"
import type { DesktopTheme } from "./types"

const nordTheme = nordThemeJson as DesktopTheme

describe("resolveThemeVariantV2", () => {
  test("oc-2 light uses full override preset", () => {
    const tokens = resolveThemeVariantV2(
      { palette: nordTheme.light.palette!, overrides: {} },
      false,
      "oc-2",
    )
    expect(tokens["v2-background-bg-base"]).toBe("var(--v2-grey-100)")
    expect(tokens["v2-grey-100"]).toBe("#ffffffff")
    expect(tokens["v2-text-text-base"]).toBe("var(--v2-grey-1000)")
  })

  test("oc-2 dark uses dark semantic preset", () => {
    const tokens = resolveThemeVariantV2(
      { palette: nordTheme.dark.palette!, overrides: {} },
      true,
      "oc-2",
    )
    expect(tokens["v2-background-bg-base"]).toBe("var(--v2-grey-1000)")
    expect(tokens["v2-text-text-base"]).toBe("var(--v2-grey-200)")
  })

  test("other themes generate grey ramp from palette", () => {
    const tokens = resolveThemeVariantV2(nordTheme.light, false, "nord")
    expect(tokens["v2-grey-100"]?.startsWith("#")).toBe(true)
    expect(tokens["v2-background-bg-base"]).toBe("var(--v2-grey-100)")
    expect(tokens["v2-blue-600"]?.startsWith("#")).toBe(true)
  })

  test("v2Overrides apply last", () => {
    const tokens = resolveThemeVariantV2(
      {
        palette: nordTheme.light.palette!,
        v2Overrides: { "v2-text-text-base": "#112233" },
      },
      false,
      "nord",
    )
    expect(tokens["v2-text-text-base"]).toBe("#112233")
  })
})

import { describe, expect, test } from "bun:test"
import type { DesktopTheme } from "../types"
import { resolveThemeV2, resolveThemeVariantV2, themeV2ToCss } from "./resolve"

const theme: DesktopTheme = await Bun.file(new URL("../themes/oc-2.json", import.meta.url)).json()

describe("contrast icon-button tokens", () => {
  test("OC-2 dark mode uses a light background and an inverse icon matching the base surface", () => {
    const tokens = resolveThemeV2(theme).dark
    expect(tokens["v2-background-bg-icon-button-contrast"]).toBe("var(--v2-grey-400)")
    expect(tokens["v2-grey-400"]).toBe("#dbdbdbff")
    expect(tokens["v2-icon-icon-inverse"]).toBe(tokens["v2-background-bg-base"])
    expect(tokens["v2-grey-1100"]).toBe("#161616ff")
    expect(tokens["v2-background-bg-contrast"]).toBe("var(--v2-grey-700)")
    expect(tokens["v2-text-text-contrast"]).toBe("var(--v2-grey-50)")
  })

  test("OC-2 light mode retains the existing contrast background and foreground", () => {
    const tokens = resolveThemeV2(theme).light
    expect(tokens["v2-background-bg-icon-button-contrast"]).toBe("var(--v2-background-bg-contrast)")
    expect(tokens["v2-background-bg-contrast"]).toBe("var(--v2-grey-1000)")
    expect(tokens["v2-text-text-contrast"]).toBe("var(--v2-grey-50)")
  })

  test.each([false, true])("custom themes without the new token receive a fallback (dark: %s)", (dark) => {
    const tokens = resolveThemeVariantV2({ ...theme.dark, v2Overrides: undefined }, dark)
    expect(tokens["v2-background-bg-icon-button-contrast"]).toBe(
      dark ? "var(--v2-grey-400)" : "var(--v2-background-bg-contrast)",
    )
    expect(themeV2ToCss(tokens)).toContain(
      `--v2-background-bg-icon-button-contrast: ${tokens["v2-background-bg-icon-button-contrast"]};`,
    )
  })

  test("custom themes can override the icon-button background independently", () => {
    const tokens = resolveThemeVariantV2(
      {
        ...theme.dark,
        v2Overrides: { ...theme.dark.v2Overrides, "v2-background-bg-icon-button-contrast": "#dddddd" },
      },
      true,
    )
    expect(tokens["v2-background-bg-icon-button-contrast"]).toBe("#dddddd")
    expect(tokens["v2-background-bg-contrast"]).toBe("var(--v2-grey-700)")
  })
})

import { describe, expect, test } from "bun:test"
import { contrastRatio } from "../color"
import { DEFAULT_THEMES, oneDarkProTheme } from "../default-themes"
import type { DesktopTheme, HexColor, ResolvedV2Theme } from "../types"
import { resolveThemeV2, resolveThemeVariantV2, themeV2ToCss } from "./resolve"

const theme: DesktopTheme = await Bun.file(new URL("../themes/oc-2.json", import.meta.url)).json()

describe("accent text contrast", () => {
  test.each(Object.entries(DEFAULT_THEMES).flatMap(([name, value]) => ([
    { name, value, mode: "light" as const },
    { name, value, mode: "dark" as const },
  ])))("$name $mode keeps workspace text readable", ({ value, mode }) => {
    expectAccentContrast(resolveThemeV2(value)[mode])
  })

  test.each([false, true])("custom palette without v2 overrides receives an accent foreground (dark: %s)", (dark) => {
    expectAccentContrast(resolveThemeVariantV2({ ...oneDarkProTheme[dark ? "dark" : "light"], v2Overrides: undefined }, dark))
  })

  test("custom accent background overrides select the foreground from the effective surface", () => {
    const tokens = resolveThemeVariantV2(
      { ...oneDarkProTheme.dark, v2Overrides: { "v2-background-bg-accent": "#3eacff" } },
      true,
    )
    expectAccentContrast(tokens)
    expect(tokens["v2-text-text-on-accent"]).not.toBe(tokens["v2-text-text-contrast"])
  })
})

describe("icon emphasis", () => {
  test.each(["light", "dark"] as const)("OC-2 %s icons increase in contrast from faint to base", (mode) => {
    expectIconEmphasis(resolveThemeV2(theme)[mode])
  })

  test.each([false, true])("custom theme fallbacks preserve icon emphasis (dark: %s)", (dark) => {
    expectIconEmphasis(resolveThemeVariantV2({ ...theme[dark ? "dark" : "light"], v2Overrides: undefined }, dark))
  })
})

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

function expectIconEmphasis(tokens: ResolvedV2Theme) {
  const resolve = (value: string): HexColor =>
    value.startsWith("var(--") ? resolve(tokens[value.slice(6, -1)]) : (value as HexColor)
  const background = resolve(tokens["v2-background-bg-base"])
  const contrast = (role: string) => contrastRatio(resolve(tokens[`v2-icon-icon-${role}`]), background)
  expect(contrast("faint")).toBeLessThan(contrast("muted"))
  expect(contrast("muted")).toBeLessThan(contrast("base"))
}

function expectAccentContrast(tokens: ResolvedV2Theme) {
  const resolve = (value: string): HexColor =>
    value.startsWith("var(--") ? resolve(tokens[value.slice(6, -1)]) : (value as HexColor)
  expect(contrastRatio(resolve(tokens["v2-text-text-on-accent"]), resolve(tokens["v2-background-bg-accent"]))).toBeGreaterThanOrEqual(4.5)
}

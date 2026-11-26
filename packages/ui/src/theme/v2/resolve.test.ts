import { describe, expect, test } from "bun:test"
import { contrastRatio } from "../color"
import type { DesktopTheme, HexColor, ResolvedV2Theme } from "../types"
import { resolveThemeV2, resolveThemeVariantV2, themeV2ToCss } from "./resolve"

const theme: DesktopTheme = await Bun.file(new URL("../themes/oc-2.json", import.meta.url)).json()

describe("icon emphasis", () => {
  test.each(["light", "dark"] as const)("OC-2 %s icons increase in contrast from faint to base", (mode) => {
    expectIconEmphasis(resolveThemeV2(theme)[mode])
  })

  test.each([false, true])("custom theme fallbacks preserve icon emphasis (dark: %s)", (dark) => {
    expectIconEmphasis(resolveThemeVariantV2({ ...theme[dark ? "dark" : "light"], v2Overrides: undefined }, dark))
  })
})

describe("focus ring colour", () => {
  test.each([
    { mode: "light", expected: "var(--v2-blue-500)" },
    { mode: "dark", expected: "var(--v2-blue-400)" },
  ] as const)("$mode uses the same focus token for OpenCode and custom-theme fallbacks", ({ mode, expected }) => {
    expect(resolveThemeV2(theme)[mode]["v2-border-border-focus"]).toBe(expected)
    expect(
      resolveThemeVariantV2({ ...theme[mode], v2Overrides: undefined }, mode === "dark")["v2-border-border-focus"],
    ).toBe(expected)
  })

  test("a custom theme can override the focus ring colour", () => {
    const tokens = resolveThemeVariantV2(
      { ...theme.dark, v2Overrides: { "v2-border-border-focus": "var(--v2-green-500)" } },
      true,
    )

    expect(tokens["v2-border-border-focus"]).toBe("var(--v2-green-500)")
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

describe("input elevation", () => {
  test.each([
    {
      mode: "light",
      input:
        "0px 0px 0px 0px var(--v2-alpha-dark-0), 0px 0px 0px 0.5px var(--v2-alpha-dark-14), 0px 1px 1.5px 0px var(--v2-alpha-dark-10)",
      button:
        "0px 0px 0px 0px var(--v2-alpha-dark-0), 0px 0px 0px 0.5px var(--v2-alpha-dark-14), 0px 1px 1.5px 0px var(--v2-alpha-dark-10)",
    },
    {
      mode: "dark",
      input:
        "0px -0.5px 0px 0px var(--v2-alpha-light-6), 0px 0px 0px 0.5px var(--v2-alpha-light-16), 0px 1px 2px 0px var(--v2-alpha-dark-0)",
      button:
        "0px -0.5px 0px 0px var(--v2-alpha-light-10), 0px 0px 0px 0.5px var(--v2-alpha-light-20), 0px 1px 2px 0px var(--v2-alpha-dark-40)",
    },
  ] as const)(
    "$mode matches Figma in OC-2 and custom-theme fallbacks without changing buttons",
    ({ mode, input, button }) => {
      for (const tokens of [
        resolveThemeV2(theme)[mode],
        resolveThemeVariantV2({ ...theme[mode], v2Overrides: undefined }, mode === "dark"),
      ]) {
        expect(tokens["v2-elevation-input"]).toBe(input)
        expect(tokens["v2-elevation-button-neutral"]).toBe(button)
      }
    },
  )
})

describe("bundled non-default themes accessibility and hierarchy", () => {
  test("every bundled theme meets WCAG 2.2 contrast and elevation hierarchy in light and dark modes", async () => {
    const dir = new URL("../themes/", import.meta.url)
    const files: string[] = []
    for await (const name of new Bun.Glob("*.json").scan({ cwd: Bun.fileURLToPath(dir) })) {
      if (name !== "oc-2.json") files.push(name)
    }

    expect(files.length).toBeGreaterThan(0)

    for (const file of files.sort()) {
      const bundled: DesktopTheme = await Bun.file(new URL(file, dir)).json()
      const resolved = resolveThemeV2(bundled)

      for (const mode of ["light", "dark"] as const) {
        const tokens = resolved[mode]
        const color = (key: string) => resolveHex(tokens, key)
        const bgBase = color("v2-background-bg-base")
        const bgAccent = color("v2-background-bg-accent")
        const bgContrast = color("v2-background-bg-contrast")
        const bgIconContrast = color("v2-background-bg-icon-button-contrast")
        const bgInverse = color("v2-background-bg-inverse")

        expectIconEmphasis(tokens)
        expect(contrastRatio(color("v2-text-text-base"), bgBase)).toBeGreaterThanOrEqual(7)
        expect(contrastRatio(color("v2-text-text-muted"), bgBase)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(color("v2-text-text-faint"), bgBase)).toBeGreaterThanOrEqual(3)
        expect(contrastRatio(color("v2-text-text-faint"), bgBase)).toBeLessThan(
          contrastRatio(color("v2-text-text-muted"), bgBase),
        )
        expect(contrastRatio(color("v2-text-text-accent"), bgBase)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(color("v2-text-text-contrast"), bgAccent)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(color("v2-text-text-contrast"), bgContrast)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(color("v2-text-text-inverse"), bgInverse)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(color("v2-icon-icon-inverse"), bgIconContrast)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(color("v2-border-border-focus"), bgBase)).toBeGreaterThanOrEqual(3)

        for (const state of ["success", "warning", "danger", "info"] as const) {
          expect(
            contrastRatio(color(`v2-state-fg-${state}`), color(`v2-state-bg-${state}`)),
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })
})

function resolveHex(tokens: ResolvedV2Theme, key: string): HexColor {
  const resolve = (value: string): HexColor =>
    value.startsWith("var(--") ? resolve(tokens[value.slice(6, -1)]) : (value as HexColor)

  return resolve(tokens[key])
}

function expectIconEmphasis(tokens: ResolvedV2Theme) {
  const background = resolveHex(tokens, "v2-background-bg-base")
  const contrast = (role: string) => contrastRatio(resolveHex(tokens, `v2-icon-icon-${role}`), background)
  expect(contrast("faint")).toBeLessThan(contrast("muted"))
  expect(contrast("muted")).toBeLessThan(contrast("base"))
}

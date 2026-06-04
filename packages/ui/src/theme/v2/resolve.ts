import { hexToOklch, oklchToHex, shift } from "../color"
import { mapV2Semantics, mergeV2Tokens } from "./mapping"
import type { DesktopTheme, HexColor, ResolvedV2Theme, ThemeVariant, V2ColorValue } from "../types"
import { V2_PRIMITIVES_DEFAULT } from "./default-primitives"

const V2_STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200] as const

interface PaletteInput {
  neutral: HexColor
  ink: HexColor
  primary: HexColor
  accent: HexColor
  success: HexColor
  warning: HexColor
  error: HexColor
  info: HexColor
  interactive: HexColor
  diffAdd: HexColor
  diffDelete: HexColor
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

/** v2 ramps: 100 = lightest, 1200 = darkest — wider spread than v1 `generateScale`. */
function generateV2HueScale(seed: HexColor, isDark: boolean): HexColor[] {
  const base = hexToOklch(seed)
  const chromaBoost = isDark ? 1 : 1.05
  const lightSteps = [
    0.99,
    0.965,
    0.93,
    0.885,
    0.835,
    clamp(base.l, 0.48, 0.72),
    clamp(base.l - 0.07, 0.4, 0.64),
    clamp(base.l - 0.14, 0.32, 0.55),
    clamp(base.l - 0.21, 0.24, 0.46),
    clamp(base.l - 0.28, 0.17, 0.38),
    clamp(base.l - 0.34, 0.12, 0.3),
    clamp(base.l - 0.4, 0.08, 0.22),
  ]
  const chromaMultipliers = [0.28, 0.48, 0.68, 0.86, 1.02, 1.28, 1.34, 1.28, 1.18, 1.08, 0.98, 0.88]

  return lightSteps.map((l, i) =>
    oklchToHex({
      l,
      c: base.c * chromaMultipliers[i]! * chromaBoost,
      h: base.h,
    }),
  )
}

function generateV2NeutralScale(neutral: HexColor, ink: HexColor, isDark: boolean): HexColor[] {
  const inkOklch = hexToOklch(ink)
  const neutralOklch = hexToOklch(neutral)
  const chroma = Math.min(Math.max(neutralOklch.c, inkOklch.c) * 0.35, 0.028)
  const chromaBoost = isDark ? 1 : 1.05
  // OC-2 ramp shape; light mode nudges surfaces + mid-tones ~5% stronger.
  const lightSteps = isDark
    ? [0.998, 0.982, 0.928, 0.84, 0.72, 0.58, 0.42, 0.28, 0.22, 0.155, 0.1, 0.07]
    : [0.998, 0.968, 0.898, 0.805, 0.685, 0.55, 0.405, 0.265, 0.22, 0.155, 0.1, 0.07]

  return lightSteps.map((l) =>
    oklchToHex({ l, c: chroma * chromaBoost * (1 - Math.abs(l - 0.55) * 1.1), h: inkOklch.h }),
  )
}

function assignHueRamp(prefix: string, scale: HexColor[]): Record<string, V2ColorValue> {
  const tokens: Record<string, V2ColorValue> = {}
  for (let i = 0; i < V2_STEPS.length; i++) {
    tokens[`v2-${prefix}-${V2_STEPS[i]}`] = scale[i]!
  }
  return tokens
}

function readPalette(variant: ThemeVariant): PaletteInput {
  if ("palette" in variant && variant.palette) {
    const palette = variant.palette
    return {
      neutral: palette.neutral,
      ink: palette.ink,
      primary: palette.primary,
      accent: palette.accent ?? palette.info,
      success: palette.success,
      warning: palette.warning,
      error: palette.error,
      info: palette.info,
      interactive: palette.interactive ?? palette.primary,
      diffAdd: palette.diffAdd ?? shift(palette.success, { c: 0.55, l: 0.14 }),
      diffDelete: palette.diffDelete ?? palette.error,
    }
  }
  if ("seeds" in variant && variant.seeds) {
    const seeds = variant.seeds
    return {
      neutral: seeds.neutral,
      ink: seeds.neutral,
      primary: seeds.primary,
      accent: seeds.info,
      success: seeds.success,
      warning: seeds.warning,
      error: seeds.error,
      info: seeds.info,
      interactive: seeds.interactive,
      diffAdd: seeds.diffAdd,
      diffDelete: seeds.diffDelete,
    }
  }
  throw new Error("Theme variant requires `palette` or `seeds`")
}

/** Build v2 primitive ramps (100 = lightest). Alpha ramps are static in `v2/styles/colors.css`. */
export function generateV2Primitives(variant: ThemeVariant, isDark: boolean): Record<string, V2ColorValue> {
  const colors = readPalette(variant)
  const grey = generateV2NeutralScale(colors.neutral, colors.ink, isDark)
  const blue = generateV2HueScale(colors.interactive, isDark)
  const green = generateV2HueScale(colors.success, isDark)
  const yellow = generateV2HueScale(colors.warning, isDark)
  const red = generateV2HueScale(colors.error, isDark)
  const purple = generateV2HueScale(colors.accent, isDark)
  const pink = generateV2HueScale(colors.info, isDark)
  const orange = generateV2HueScale(shift(colors.warning, { h: -22, l: -0.082, c: 0.94 }), isDark)
  const cyan = generateV2HueScale(shift(colors.info, { h: -12, l: 0.128, c: 1.12 }), isDark)

  return {
    ...V2_PRIMITIVES_DEFAULT,
    ...assignHueRamp("grey", grey),
    ...assignHueRamp("blue", blue),
    ...assignHueRamp("green", green),
    ...assignHueRamp("yellow", yellow),
    ...assignHueRamp("red", red),
    ...assignHueRamp("purple", purple),
    ...assignHueRamp("pink", pink),
    ...assignHueRamp("orange", orange),
    ...assignHueRamp("cyan", cyan),
  }
}

export function resolveThemeVariantV2(variant: ThemeVariant, isDark: boolean): ResolvedV2Theme {
  const primitives = generateV2Primitives(variant, isDark)
  const semantics = mapV2Semantics(isDark)
  const overrides = variant.v2Overrides ?? {}
  return mergeV2Tokens(primitives, semantics, overrides)
}

export function resolveThemeV2(theme: DesktopTheme): { light: ResolvedV2Theme; dark: ResolvedV2Theme } {
  return {
    light: resolveThemeVariantV2(theme.light, false),
    dark: resolveThemeVariantV2(theme.dark, true),
  }
}

export function themeV2ToCss(tokens: ResolvedV2Theme): string {
  return Object.entries(tokens)
    .map(([key, value]) => `--${key}: ${value};`)
    .join("\n  ")
}

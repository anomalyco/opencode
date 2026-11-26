// @refresh reload

import { ensureContrast, hexToOklch, hueDistance, oklchToHexExact, shift, withAlpha } from "../color"
import { mapV2Foreground } from "./foreground"
import { mapV2Semantics, mergeV2Tokens } from "./mapping"
import type { DesktopTheme, HexColor, ResolvedV2Theme, ThemeVariant } from "../types"
import { V2_PRIMITIVES_DEFAULT } from "./default-primitives"

const V2_GREY_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200] as const

const V2_STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200] as const

export interface ResolvedV2ThemeModes {
  light: ResolvedV2Theme
  dark: ResolvedV2Theme
}

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

interface HueScaleAnchors {
  bgBase: HexColor
  textContrast: HexColor
  monochrome?: boolean
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function readHex(tokens: ResolvedV2Theme, key: string): HexColor {
  const value = tokens[key]

  if (value && value.startsWith("#")) {
    // SAFETY: startsWith("#") verifies the HexColor template-literal prefix.
    return value as HexColor
  }

  throw new Error(`Expected hex token for ${key}, got ${value}`)
}

/**
 * 13-step perceptual neutral ramp (50 = lightest, 1200 = darkest) aligned to OC-2's V2 surface ladder.
 * Light mode anchors bg-base at 50 and steps down; dark mode anchors bg-base at 1100 and elevates toward 700.
 */
function generateV2NeutralScale(neutral: HexColor, ink: HexColor, isDark: boolean): HexColor[] {
  const n = hexToOklch(neutral)
  const k = hexToOklch(ink)
  const hue = n.c >= 0.004 ? n.h : k.c >= 0.004 ? k.h : 0
  const baseC = n.c >= 0.004 ? Math.min(n.c, 0.062) : Math.min(k.c * 0.25, 0.008)

  if (isDark) {
    const l1100 = clamp(n.l, 0, 0.36)
    const pureBlack = l1100 < 0.06
    const l1200 = pureBlack ? 0 : Math.max(0.08, l1100 - 0.052)

    const span = clamp(0.475 - l1100, 0.13, 0.275)
    const l1000 = pureBlack ? 0.165 : l1100 + span * 0.21
    const l900 = pureBlack ? 0.215 : l1100 + span * 0.38
    const l800 = pureBlack ? 0.275 : l1100 + span * 0.56
    const l700 = pureBlack ? 0.375 : l1100 + span

    const l100 = clamp(k.l, 0.86, 0.985)
    const l50 = Math.max(l100 + 0.015, 0.985)
    const hiSpan = l100 - l700

    const lightSteps = [
      l50,
      l100,
      l700 + hiSpan * 0.95,
      l700 + hiSpan * 0.9,
      l700 + hiSpan * 0.8,
      l700 + hiSpan * 0.54,
      l700 + hiSpan * 0.26,
      l700,
      l800,
      l900,
      l1000,
      l1100,
      l1200,
    ]

    return lightSteps.map((l, idx) => {
      const chromaScale = idx === 0 ? 0.12 : idx <= 2 ? 0.25 : idx <= 6 ? 0.55 : idx === 12 ? 0.88 : 1

      return oklchToHexExact({ l, c: baseC * chromaScale, h: hue })
    })
  }

  const l50 = clamp(n.l, 0.87, 1)
  const l100 = l50 - 0.022
  const l200 = l50 - 0.048
  const l300 = l50 - 0.072
  const l400 = l50 - 0.118

  const l1100 = clamp(k.l, 0.16, 0.28)
  const l1200 = Math.max(0.11, l1100 - 0.06)
  const l1000 = l1100 + 0.055
  const l900 = l1100 + 0.1
  const l800 = l1100 + 0.15
  const midSpan = l400 - l800
  const darkHue = k.c >= 0.01 ? k.h : hue
  const darkC = Math.max(baseC, Math.min(k.c, 0.055))

  const lightSteps = [
    l50,
    l100,
    l200,
    l300,
    l400,
    l400 - midSpan * 0.2,
    l400 - midSpan * 0.46,
    l400 - midSpan * 0.72,
    l800,
    l900,
    l1000,
    l1100,
    l1200,
  ]

  return lightSteps.map((l, idx) => {
    if (idx >= 8) {
      const darkScale = idx === 10 ? 1.1 : 0.9

      return oklchToHexExact({ l, c: Math.min(darkC * darkScale, 0.062), h: darkHue })
    }

    const chromaScale = idx === 0 ? 1 : idx === 1 ? 1.14 : idx === 2 ? 1.24 : idx <= 4 ? 1.28 : 0.85

    return oklchToHexExact({ l, c: Math.min(baseC * chromaScale, 0.072), h: hue })
  })
}

/**
 * 12-step contrast-calibrated OKLCH hue ramp (100 = lightest, 1200 = darkest).
 * Guarantees WCAG 2.2 contrast on interactive accent fills (600), focus rings (500/400),
 * accent text (600/400), and semantic state badges (100/800 light, 1200/500 dark).
 */
function generateV2HueScale(seed: HexColor, isDark: boolean, anchors: HueScaleAnchors): HexColor[] {
  const base = hexToOklch(seed)
  const bgBaseL = hexToOklch(anchors.bgBase).l
  const mono = Boolean(anchors.monochrome) && base.c < 0.025
  const chroma = mono ? base.c : clamp(base.c, 0.075, 0.22)
  const h = base.h

  const step100 = oklchToHexExact({
    l: isDark ? 0.965 : clamp(bgBaseL - 0.006, 0.935, 0.972),
    c: Math.min(chroma * 0.18, 0.028),
    h,
  })

  const step200 = oklchToHexExact({
    l: isDark ? 0.925 : clamp(bgBaseL - 0.032, 0.9, 0.945),
    c: Math.min(chroma * 0.34, 0.052),
    h,
  })

  const step300 = oklchToHexExact({ l: 0.855, c: Math.min(chroma * 0.56, 0.09), h })

  const raw400 = oklchToHexExact({ l: clamp(base.l, 0.73, 0.82), c: Math.min(chroma * 0.88, 0.185), h })
  const step400 = isDark ? ensureContrast(raw400, anchors.bgBase, 6.2, "lighter") : raw400

  const raw1200 = oklchToHexExact({
    l: isDark ? clamp(bgBaseL + 0.035, 0.2, 0.31) : 0.23,
    c: mono ? chroma * 0.42 : clamp(chroma * 0.42, 0.035, 0.072),
    h,
  })

  const raw500 = oklchToHexExact({ l: 0.67, c: Math.min(chroma * 1.02, 0.2), h })

  const step500 = isDark
    ? ensureContrast(ensureContrast(raw500, raw1200, 5.2, "lighter"), anchors.bgBase, 5.0, "lighter")
    : ensureContrast(raw500, anchors.bgBase, 3.1, "darker")

  const raw600 = oklchToHexExact({ l: clamp(base.l, 0.48, 0.55), c: Math.min(chroma * 1.12, 0.235), h })
  const contrastChecked600 = ensureContrast(raw600, anchors.textContrast, 4.6, "darker")
  const step600 = isDark ? contrastChecked600 : ensureContrast(contrastChecked600, anchors.bgBase, 4.6, "darker")
  const l600 = hexToOklch(step600).l

  const raw700 = oklchToHexExact({ l: Math.max(0.36, l600 - 0.055), c: Math.min(chroma * 1.14, 0.24), h })
  const step700 = isDark ? raw700 : ensureContrast(raw700, anchors.bgBase, 5.5, "darker")

  const raw800 = oklchToHexExact({ l: Math.min(0.49, l600 - 0.03), c: Math.min(chroma * 1.06, 0.21), h })

  const step800 = isDark
    ? raw800
    : ensureContrast(
        ensureContrast(ensureContrast(raw800, step100, 4.8, "darker"), step200, 4.6, "darker"),
        anchors.bgBase,
        4.6,
        "darker",
      )

  const step900 = oklchToHexExact({
    l: clamp(hexToOklch(step800).l - 0.05, 0.36, 0.45),
    c: Math.min(chroma * 0.94, 0.19),
    h,
  })

  const step1000 = oklchToHexExact({ l: 0.35, c: Math.min(chroma * 0.82, 0.16), h })
  const step1100 = oklchToHexExact({ l: 0.28, c: Math.min(chroma * 0.68, 0.13), h })

  return [step100, step200, step300, step400, step500, step600, step700, step800, step900, step1000, step1100, raw1200]
}

function assignSteps(prefix: string, steps: readonly number[], scale: HexColor[]): ResolvedV2Theme {
  const tokens: ResolvedV2Theme = {}

  for (let i = 0; i < steps.length; i++) {
    tokens[`v2-${prefix}-${steps[i]}`] = scale[i]!
  }

  return tokens
}

function distinctPlanSeed(info: HexColor, accent: HexColor, interactive: HexColor): HexColor {
  const interactiveHue = hexToOklch(interactive).h

  if (hueDistance(hexToOklch(info).h, interactiveHue) >= 28) return info

  if (hueDistance(hexToOklch(accent).h, interactiveHue) >= 28) return accent

  return shift(info, { h: 48 })
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

/** Build v2 primitive ramps (50/100 = lightest, 1200 = darkest). Alpha ramps are static in `v2/styles/colors.css`. */
export function generateV2Primitives(variant: ThemeVariant, isDark: boolean): ResolvedV2Theme {
  const colors = readPalette(variant)
  const grey = generateV2NeutralScale(colors.neutral, colors.ink, isDark)

  const monochrome = hexToOklch(colors.primary).c < 0.025 && hexToOklch(colors.interactive).c < 0.025

  const anchors: HueScaleAnchors = {
    bgBase: isDark ? grey[11]! : grey[0]!,
    textContrast: grey[0]!,
    monochrome,
  }

  const blue = generateV2HueScale(colors.interactive, isDark, anchors)
  const green = generateV2HueScale(colors.success, isDark, anchors)
  const yellow = generateV2HueScale(colors.warning, isDark, anchors)
  const red = generateV2HueScale(colors.error, isDark, anchors)
  const purple = generateV2HueScale(colors.accent, isDark, anchors)
  const pink = generateV2HueScale(distinctPlanSeed(colors.info, colors.accent, colors.interactive), isDark, anchors)
  const orange = generateV2HueScale(shift(colors.warning, { h: -22, l: -0.082, c: 0.94 }), isDark, anchors)
  const cyan = generateV2HueScale(shift(colors.info, { h: -12, l: 0.128, c: 1.12 }), isDark, anchors)

  return {
    ...V2_PRIMITIVES_DEFAULT,
    ...assignSteps("grey", V2_GREY_STEPS, grey),
    ...assignSteps("blue", V2_STEPS, blue),
    ...assignSteps("green", V2_STEPS, green),
    ...assignSteps("yellow", V2_STEPS, yellow),
    ...assignSteps("red", V2_STEPS, red),
    ...assignSteps("purple", V2_STEPS, purple),
    ...assignSteps("pink", V2_STEPS, pink),
    ...assignSteps("orange", V2_STEPS, orange),
    ...assignSteps("cyan", V2_STEPS, cyan),
  }
}

function themeDynamicSemantics(primitives: ResolvedV2Theme, isDark: boolean): ResolvedV2Theme {
  const hex = (key: string) => readHex(primitives, key)
  const transparent = (key: string) => `${hex(key).slice(0, 7)}00`

  return {
    "v2-overlay-simple-tab-active-scrim": transparent(isDark ? "v2-grey-1000" : "v2-grey-100"),
    "v2-overlay-simple-tab-hover-scrim": transparent(isDark ? "v2-grey-800" : "v2-grey-300"),
    "v2-overlay-simple-tab-scrim": transparent(isDark ? "v2-grey-1200" : "v2-grey-100"),
    "v2-agent-plan-border": withAlpha(hex(isDark ? "v2-pink-400" : "v2-pink-800"), 0.2),
    "v2-agent-plan-background": withAlpha(hex("v2-pink-600"), isDark ? 0.1 : 0.08),
    "v2-agent-build-border": withAlpha(hex(isDark ? "v2-blue-300" : "v2-blue-800"), isDark ? 0.2 : 0.14),
    "v2-agent-build-background": withAlpha(hex("v2-blue-600"), isDark ? 0.1 : 0.08),
    "v2-agent-explore-border": withAlpha(hex(isDark ? "v2-yellow-300" : "v2-yellow-800"), 0.2),
    "v2-agent-explore-background": withAlpha(hex("v2-yellow-600"), isDark ? 0.1 : 0.08),
  }
}

/**
 * Aligns legacy v1 tokens consumed by code blocks (`--background-stronger`), diffs (`--diffs-bg`,
 * `--surface-diff-hidden-*`, `--text-diff-*`), and syntax highlights with the theme's v2 surfaces.
 * Skipped when a theme supplies explicit v2 surface overrides (such as `oc-2`).
 */
function v1CodeAndDiffBridge(variant: ThemeVariant, primitives: ResolvedV2Theme, isDark: boolean): ResolvedV2Theme {
  if (variant.v2Overrides?.["v2-background-bg-base"]) return {}

  const overrides = variant.overrides ?? {}
  const colors = readPalette(variant)
  const codeBg = readHex(primitives, isDark ? "v2-grey-1000" : "v2-grey-100")
  const dir = isDark ? "lighter" : "darker"
  const syntaxColor = (seed: HexColor) => ensureContrast(seed, codeBg, 4.55, dir)

  const tokens: ResolvedV2Theme = {}

  const defaults: ResolvedV2Theme = {
    "background-base": "var(--v2-background-bg-base)",
    "background-weak": "var(--v2-background-bg-layer-01)",
    "background-strong": "var(--v2-background-bg-base)",
    "background-stronger": "var(--v2-background-bg-layer-01)",
    "surface-base": "var(--v2-background-bg-layer-01)",
    "surface-raised-base": "var(--v2-background-bg-layer-01)",
    "surface-raised-stronger-non-alpha": "var(--v2-background-bg-layer-02)",
    "surface-diff-hidden-base": "var(--v2-background-bg-layer-02)",
    "surface-diff-hidden-strong": "var(--v2-background-bg-layer-03)",
    "icon-weak": "var(--v2-icon-icon-muted)",
    "icon-weaker": "var(--v2-icon-icon-faint)",
    "text-base": "var(--v2-text-text-base)",
    "text-strong": "var(--v2-text-text-base)",
    "text-weak": "var(--v2-text-text-muted)",
    "text-weaker": "var(--v2-text-text-faint)",
    "icon-base": "var(--v2-icon-icon-muted)",
    "icon-strong-base": "var(--v2-icon-icon-base)",
    "icon-weak-base": "var(--v2-icon-icon-faint)",
    "text-diff-add-base": "var(--v2-state-fg-success)",
    "text-diff-delete-base": "var(--v2-state-fg-danger)",
    "syntax-diff-add": "var(--v2-state-fg-success)",
    "syntax-diff-delete": "var(--v2-state-fg-danger)",
    "syntax-comment": "var(--v2-text-text-muted)",
    "syntax-variable": "var(--v2-text-text-base)",
    "syntax-object": "var(--v2-text-text-base)",
    "syntax-operator": "var(--v2-text-text-muted)",
    "syntax-punctuation": "var(--v2-text-text-muted)",
    "syntax-string": syntaxColor(colors.success),
    "syntax-keyword": syntaxColor(colors.accent),
    "syntax-primitive": syntaxColor(colors.primary),
    "syntax-property": syntaxColor(colors.info),
    "syntax-type": syntaxColor(colors.warning),
    "syntax-constant": syntaxColor(colors.accent),
    "syntax-info": syntaxColor(colors.info),
  }

  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in overrides)) tokens[key] = value
  }

  return tokens
}

export function resolveThemeVariantV2(variant: ThemeVariant, isDark: boolean): ResolvedV2Theme {
  const primitives = generateV2Primitives(variant, isDark)
  const semantics = mapV2Semantics(isDark)
  const dynamic = themeDynamicSemantics(primitives, isDark)
  const foreground = mapV2Foreground(readPalette(variant).ink, isDark, primitives, variant.overrides)
  const bridge = v1CodeAndDiffBridge(variant, primitives, isDark)

  return mergeV2Tokens(primitives, semantics, dynamic, foreground, bridge, variant.v2Overrides ?? {})
}

export function resolveThemeV2(theme: DesktopTheme): ResolvedV2ThemeModes {
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

import { contrastRatio, ensureContrast, hexToOklch, oklchToHex } from "../color"
import { mapV2Semantics } from "./mapping"
import type { ColorValue, HexColor, V2ColorValue } from "../types"

const GREY_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200] as const

const greyRef = (step: number): V2ColorValue => `var(--v2-grey-${step})`

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function opaqueHex(value: ColorValue | undefined): HexColor | undefined {
  if (typeof value !== "string") return
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value as HexColor
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const h = value.slice(1)
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` as HexColor
  }
}

function greyHex(primitives: Record<string, V2ColorValue>, step: number) {
  const hex = primitives[`v2-grey-${step}`]

  if (typeof hex === "string" && hex.startsWith("#")) return hex as HexColor
}

function resolveGreyRef(value: V2ColorValue, primitives: Record<string, V2ColorValue>) {
  const step = value.match(/^var\(--v2-grey-(\d+)\)$/)?.[1]

  if (!step) throw new Error(`Expected grey primitive ref, got ${value}`)
  const hex = greyHex(primitives, Number(step))

  if (!hex) throw new Error(`Missing grey primitive v2-grey-${step}`)

  return hex
}

function pickGrey(
  primitives: Record<string, V2ColorValue>,
  background: HexColor,
  minContrast: number,
  target: number,
  maxContrast = Infinity,
) {
  const matches = GREY_STEPS.filter((step) => {
    const hex = greyHex(primitives, step)
    if (!hex) return false
    const ratio = contrastRatio(hex, background)

    return ratio >= minContrast && ratio < maxContrast
  })

  if (matches.length === 0) return target

  return matches.reduce((best, step) => (Math.abs(step - target) < Math.abs(best - target) ? step : best))
}

function resolveMutedText(
  textBase: HexColor,
  bgBase: HexColor,
  isDark: boolean,
  overrideWeak: HexColor | undefined,
): HexColor {
  const baseL = hexToOklch(textBase).l
  const bgL = hexToOklch(bgBase).l
  const direction = isDark ? "lighter" : "darker"

  const source = hexToOklch(overrideWeak ?? textBase)
  const chroma = Math.min(source.c, 0.055)
  const targetL = overrideWeak
    ? isDark
      ? clamp(source.l, bgL + 0.28, baseL - 0.14)
      : clamp(source.l, baseL + 0.16, bgL - 0.26)
    : isDark
      ? clamp(baseL - 0.2, bgL + 0.34, 0.77)
      : clamp(baseL + 0.26, 0.4, bgL - 0.32)

  return ensureContrast(oklchToHex({ l: targetL, c: chroma, h: source.h }), bgBase, 4.6, direction)
}

function resolveFaintText(textMuted: HexColor, bgBase: HexColor, isDark: boolean): HexColor {
  const muted = hexToOklch(textMuted)
  const bgL = hexToOklch(bgBase).l
  const direction = isDark ? "lighter" : "darker"
  const mutedContrast = contrastRatio(textMuted, bgBase)

  const targetL = isDark ? clamp(muted.l - 0.12, bgL + 0.22, muted.l - 0.08) : clamp(muted.l + 0.12, muted.l + 0.08, bgL - 0.2)
  const candidate = ensureContrast(
    oklchToHex({ l: targetL, c: muted.c * 0.8, h: muted.h }),
    bgBase,
    3.1,
    direction,
  )

  if (contrastRatio(candidate, bgBase) < mutedContrast - 0.3) return candidate

  // Keep faint visually subordinate to muted even on low-headroom themes.
  const fallbackL = isDark ? Math.max(bgL + 0.16, muted.l - 0.09) : Math.min(bgL - 0.16, muted.l + 0.09)

  return oklchToHex({ l: fallbackL, c: muted.c * 0.75, h: muted.h })
}

export function mapV2Foreground(
  ink: HexColor,
  isDark: boolean,
  primitives: Record<string, V2ColorValue>,
  overrides: Record<string, ColorValue> = {},
): Record<string, V2ColorValue> {
  const semantics = mapV2Semantics(isDark)
  const bgBase = resolveGreyRef(semantics["v2-background-bg-base"], primitives)
  const bgLayer02 = resolveGreyRef(semantics["v2-background-bg-layer-02"], primitives)
  const bgContrast = resolveGreyRef(semantics["v2-background-bg-contrast"], primitives)
  const bgInverse = resolveGreyRef(semantics["v2-background-bg-inverse"], primitives)
  const direction = isDark ? "lighter" : "darker"

  const rawInk = hexToOklch(ink)
  const proseInk = oklchToHex({ l: rawInk.l, c: Math.min(rawInk.c, 0.085), h: rawInk.h })
  const textBase = ensureContrast(ensureContrast(proseInk, bgBase, 7.0, direction), bgLayer02, 4.5, direction)
  const textMuted = resolveMutedText(textBase, bgBase, isDark, opaqueHex(overrides["text-weak"]))
  const textFaint = resolveFaintText(textMuted, bgBase, isDark)

  const iconBaseStep = pickGrey(primitives, bgBase, 6.5, isDark ? 400 : 800)
  const iconBaseContrast = contrastRatio(greyHex(primitives, iconBaseStep)!, bgBase)
  const iconMutedStep = pickGrey(primitives, bgBase, 3.2, 600, iconBaseContrast - 0.5)
  const iconMutedContrast = contrastRatio(greyHex(primitives, iconMutedStep)!, bgBase)
  const iconFaintStep = pickGrey(primitives, bgBase, 1.8, isDark ? 700 : 500, iconMutedContrast - 0.4)
  const inverseTarget = hexToOklch(bgInverse).l > 0.55 ? 1100 : 50

  return {
    "v2-text-text-base": textBase,
    "v2-text-text-muted": textMuted,
    "v2-text-text-faint": textFaint,
    "v2-icon-icon-base": greyRef(iconBaseStep),
    "v2-icon-icon-muted": greyRef(iconMutedStep),
    "v2-icon-icon-faint": greyRef(iconFaintStep),
    "v2-icon-icon-inverse": greyRef(pickGrey(primitives, bgInverse, 7, inverseTarget)),
    "v2-icon-icon-contrast": greyRef(pickGrey(primitives, bgContrast, 5.5, 50)),
    "v2-icon-icon-accent": isDark ? "var(--v2-blue-400)" : "var(--v2-blue-600)",
    "v2-icon-icon-accent-hover": isDark ? "var(--v2-blue-300)" : "var(--v2-blue-700)",
  }
}

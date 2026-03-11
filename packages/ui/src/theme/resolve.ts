import type { ColorValue, DesktopTheme, HexColor, ResolvedTheme, ThemeVariant } from "./types"
import { blend, generateNeutralScale, generateScale, hexToOklch, oklchToHex, shift, withAlpha } from "./color"

export function resolveThemeVariant(variant: ThemeVariant, isDark: boolean): ResolvedTheme {
  const colors = getColors(variant)
  const { overrides = {} } = variant

  const neutral = generateNeutralScale(colors.neutral, isDark)
  const primary = generateScale(colors.primary, isDark)
  const accent = generateScale(colors.accent, isDark)
  const success = generateScale(colors.success, isDark)
  const warning = generateScale(colors.warning, isDark)
  const error = generateScale(colors.error, isDark)
  const info = generateScale(colors.info, isDark)
  const interactive = generateScale(colors.interactive, isDark)
  const hasInk = colors.compact && Boolean(colors.ink)
  const noInk = colors.compact && !hasInk
  const shadow = noInk && !isDark ? generateNeutralScale(colors.neutral, true) : neutral
  const amber = generateScale(
    shift(colors.warning, isDark ? { h: -16, l: -0.058, c: 1.14 } : { h: -22, l: -0.082, c: 0.94 }),
    isDark,
  )
  const blue = generateScale(shift(colors.interactive, { h: -12, l: 0.128, c: 1.12 }), isDark)
  const brandl = noInk && isDark ? generateScale(colors.primary, false) : primary
  const successl = noInk && isDark ? generateScale(colors.success, false) : success
  const warningl = noInk && isDark ? generateScale(colors.warning, false) : warning
  const infol = noInk && isDark ? generateScale(colors.info, false) : info
  const interl = noInk && isDark ? generateScale(colors.interactive, false) : interactive
  const diffAdd = generateScale(
    colors.diffAdd ??
      (noInk
        ? shift(colors.success, { c: isDark ? 0.54 : 0.6, l: isDark ? 0.22 : 0.16 })
        : shift(colors.success, { c: isDark ? 0.7 : 0.55, l: isDark ? -0.18 : 0.14 })),
    isDark,
  )
  const diffDelete = generateScale(
    colors.diffDelete ??
      (noInk ? colors.error : shift(colors.error, { c: isDark ? 0.82 : 0.7, l: isDark ? -0.08 : 0.08 })),
    isDark,
  )
  const ink = colors.ink ?? colors.neutral
  const backgroundOverride = overrides["background-base"]
  const backgroundHex = getHex(backgroundOverride)
  const overlay = noInk || (Boolean(backgroundOverride) && !backgroundHex)
  const content = (seed: HexColor, scale: HexColor[]) => {
    const value = isDark ? seed : hexToOklch(seed).l > 0.82 ? scale[10] : seed
    return shift(value, { c: isDark ? 1.16 : 1.1 })
  }
  const modified = () => {
    if (!colors.compact) return isDark ? "#ffba92" : "#FF8C00"
    if (!hasInk) return isDark ? "#ffba92" : "#FF8C00"
    const warningHue = hexToOklch(colors.warning).h
    const deleteHue = hexToOklch(colors.diffDelete ?? colors.error).h
    const delta = Math.abs(((((deleteHue - warningHue) % 360) + 540) % 360) - 180)
    if (delta < 48) return isDark ? "#ffba92" : "#FF8C00"
    return content(colors.warning, warning)
  }
  const surface = (
    seed: HexColor,
    alpha: { base: number; weak: number; weaker: number; strong: number; stronger: number },
  ) => {
    const base = alphaTone(seed, alpha.base)
    return {
      base,
      weak: alphaTone(seed, alpha.weak),
      weaker: alphaTone(seed, alpha.weaker),
      strong: alphaTone(seed, alpha.strong),
      stronger: alphaTone(seed, alpha.stronger),
    }
  }
  const compactBackground =
    colors.compact && !hasInk
      ? isDark
        ? {
            base: shift(blend(colors.neutral, "#000000", 0.145), { c: 0 }),
            weak: shift(blend(colors.neutral, "#000000", 0.27), { c: 0 }),
            strong: shift(blend(colors.neutral, "#000000", 0.165), { c: 0 }),
            stronger: shift(blend(colors.neutral, "#000000", 0.19), { c: 0 }),
          }
        : {
            base: blend(colors.neutral, "#ffffff", 0.066),
            weak: blend(colors.neutral, "#ffffff", 0.11),
            strong: blend(colors.neutral, "#ffffff", 0.024),
            stronger: blend(colors.neutral, "#ffffff", 0.024),
          }
      : undefined
  const compactInkBackground =
    colors.compact && hasInk && isDark
      ? {
          base: neutral[2],
          weak: neutral[3],
          strong: neutral[1],
          stronger: neutral[2],
        }
      : undefined

  const background = backgroundHex ?? compactInkBackground?.base ?? compactBackground?.base ?? neutral[0]
  const alphaTone = (color: HexColor, alpha: number) =>
    overlay ? (withAlpha(color, alpha) as ColorValue) : blend(color, background, alpha)
  const borderTone = (light: number, dark: number) =>
    alphaTone(
      ink,
      isDark ? Math.min(1, dark + 0.024 + (colors.compact && hasInk ? 0.08 : 0)) : Math.min(1, light + 0.024),
    )
  const diffHiddenSurface = noInk
    ? {
        base: blue[isDark ? 1 : 2],
        weak: blue[isDark ? 0 : 1],
        weaker: blue[isDark ? 2 : 0],
        strong: blue[4],
        stronger: blue[isDark ? 10 : 8],
      }
    : surface(
        isDark ? shift(colors.interactive, { c: 0.55, l: 0 }) : shift(colors.interactive, { c: 0.45, l: 0.08 }),
        isDark
          ? { base: 0.14, weak: 0.08, weaker: 0.18, strong: 0.26, stronger: 0.42 }
          : { base: 0.12, weak: 0.08, weaker: 0.16, strong: 0.24, stronger: 0.36 },
      )

  const neutralAlpha = noInk ? generateNeutralOverlayScale(neutral, isDark) : generateNeutralAlphaScale(neutral, isDark)

  const tokens: ResolvedTheme = {}

  tokens["background-base"] = compactInkBackground?.base ?? compactBackground?.base ?? neutral[0]
  tokens["background-weak"] = compactInkBackground?.weak ?? compactBackground?.weak ?? neutral[2]
  tokens["background-strong"] = compactInkBackground?.strong ?? compactBackground?.strong ?? neutral[0]
  tokens["background-stronger"] =
    compactInkBackground?.stronger ?? compactBackground?.stronger ?? (isDark ? neutral[1] : "#fcfcfc")

  tokens["surface-base"] = neutralAlpha[1]
  tokens["base"] = neutralAlpha[1]
  tokens["surface-base-hover"] = neutralAlpha[2]
  tokens["surface-base-active"] = neutralAlpha[2]
  tokens["surface-base-interactive-active"] = withAlpha(interactive[2], 0.3) as ColorValue
  tokens["base2"] = neutralAlpha[1]
  tokens["base3"] = neutralAlpha[1]
  tokens["surface-inset-base"] = neutralAlpha[1]
  tokens["surface-inset-base-hover"] = neutralAlpha[2]
  tokens["surface-inset-strong"] = isDark
    ? (withAlpha(neutral[0], 0.5) as ColorValue)
    : (withAlpha(neutral[3], 0.09) as ColorValue)
  tokens["surface-inset-strong-hover"] = tokens["surface-inset-strong"]
  tokens["surface-raised-base"] = neutralAlpha[0]
  tokens["surface-float-base"] = isDark ? neutral[0] : noInk ? shadow[0] : neutral[11]
  tokens["surface-float-base-hover"] = isDark ? neutral[1] : noInk ? shadow[1] : neutral[10]
  tokens["surface-raised-base-hover"] = neutralAlpha[1]
  tokens["surface-raised-base-active"] = neutralAlpha[2]
  tokens["surface-raised-strong"] = isDark ? neutralAlpha[3] : neutral[0]
  tokens["surface-raised-strong-hover"] = isDark ? neutralAlpha[5] : "#ffffff"
  tokens["surface-raised-stronger"] = isDark ? neutralAlpha[5] : "#ffffff"
  tokens["surface-raised-stronger-hover"] = isDark ? neutralAlpha[6] : "#ffffff"
  tokens["surface-weak"] = neutralAlpha[2]
  tokens["surface-weaker"] = neutralAlpha[3]
  tokens["surface-strong"] = isDark ? neutralAlpha[6] : "#ffffff"
  tokens["surface-raised-stronger-non-alpha"] = isDark ? neutral[2] : "#ffffff"

  tokens["surface-brand-base"] = brandl[8]
  tokens["surface-brand-hover"] = brandl[9]

  tokens["surface-interactive-base"] = interactive[isDark ? 4 : 3]
  tokens["surface-interactive-hover"] = interactive[isDark ? 5 : 4]
  tokens["surface-interactive-weak"] = interactive[isDark ? 3 : 2]
  tokens["surface-interactive-weak-hover"] = noInk && isDark ? interl[4] : interactive[isDark ? 4 : 3]

  tokens["surface-success-base"] = success[isDark ? 4 : 3]
  tokens["surface-success-weak"] = success[isDark ? 3 : 2]
  tokens["surface-success-strong"] = success[9]
  tokens["surface-warning-base"] = (noInk && isDark ? warningl : warning)[isDark ? 4 : 3]
  tokens["surface-warning-weak"] = (noInk && isDark ? warningl : warning)[isDark ? 3 : 2]
  tokens["surface-warning-strong"] = (noInk && isDark ? warningl : warning)[9]
  tokens["surface-critical-base"] = error[isDark ? 4 : 3]
  tokens["surface-critical-weak"] = error[isDark ? 3 : 2]
  tokens["surface-critical-strong"] = error[9]
  tokens["surface-info-base"] = (noInk && isDark ? infol : info)[isDark ? 4 : 3]
  tokens["surface-info-weak"] = (noInk && isDark ? infol : info)[isDark ? 3 : 2]
  tokens["surface-info-strong"] = (noInk && isDark ? infol : info)[9]

  tokens["surface-diff-unchanged-base"] = isDark ? neutral[0] : "#ffffff00"
  tokens["surface-diff-skip-base"] = isDark ? neutralAlpha[0] : neutral[1]
  tokens["surface-diff-hidden-base"] = diffHiddenSurface.base
  tokens["surface-diff-hidden-weak"] = diffHiddenSurface.weak
  tokens["surface-diff-hidden-weaker"] = diffHiddenSurface.weaker
  tokens["surface-diff-hidden-strong"] = diffHiddenSurface.strong
  tokens["surface-diff-hidden-stronger"] = diffHiddenSurface.stronger
  tokens["surface-diff-add-base"] = diffAdd[2]
  tokens["surface-diff-add-weak"] = diffAdd[isDark ? 3 : 1]
  tokens["surface-diff-add-weaker"] = diffAdd[isDark ? 2 : 0]
  tokens["surface-diff-add-strong"] = diffAdd[4]
  tokens["surface-diff-add-stronger"] = diffAdd[isDark ? 10 : 8]
  tokens["surface-diff-delete-base"] = diffDelete[2]
  tokens["surface-diff-delete-weak"] = diffDelete[isDark ? 3 : 1]
  tokens["surface-diff-delete-weaker"] = diffDelete[isDark ? 2 : 0]
  tokens["surface-diff-delete-strong"] = diffDelete[isDark ? 4 : 5]
  tokens["surface-diff-delete-stronger"] = diffDelete[isDark ? 10 : 8]

  tokens["input-base"] = isDark ? neutral[1] : neutral[0]
  tokens["input-hover"] = neutral[1]
  tokens["input-active"] = interactive[0]
  tokens["input-selected"] = interactive[3]
  tokens["input-focus"] = interactive[0]
  tokens["input-disabled"] = neutral[3]

  tokens["text-base"] = hasInk ? ink : noInk ? (isDark ? neutralAlpha[10] : neutral[10]) : neutral[10]
  tokens["text-weak"] = hasInk
    ? shift(ink, { l: isDark ? -0.18 : 0.16, c: 0.88 })
    : noInk
      ? isDark
        ? neutralAlpha[8]
        : neutral[8]
      : neutral[8]
  tokens["text-weaker"] = hasInk
    ? shift(ink, { l: isDark ? -0.3 : 0.26, c: isDark ? 0.74 : 0.68 })
    : noInk
      ? isDark
        ? neutralAlpha[7]
        : neutral[7]
      : neutral[7]
  tokens["text-strong"] = hasInk
    ? isDark && colors.compact
      ? blend("#ffffff", ink, 0.82)
      : shift(ink, { l: isDark ? 0.06 : -0.09, c: 1 })
    : noInk
      ? isDark
        ? neutralAlpha[11]
        : neutral[11]
      : neutral[11]
  if (noInk && isDark) {
    tokens["text-base"] = withAlpha("#ffffff", 0.618) as ColorValue
    tokens["text-weak"] = withAlpha("#ffffff", 0.422) as ColorValue
    tokens["text-weaker"] = withAlpha("#ffffff", 0.284) as ColorValue
    tokens["text-strong"] = withAlpha("#ffffff", 0.936) as ColorValue
  }
  tokens["text-invert-base"] = isDark ? neutral[10] : neutral[1]
  tokens["text-invert-weak"] = isDark ? neutral[8] : neutral[2]
  tokens["text-invert-weaker"] = isDark ? neutral[7] : neutral[3]
  tokens["text-invert-strong"] = isDark ? neutral[11] : neutral[0]
  tokens["text-interactive-base"] = interactive[isDark ? 10 : 8]
  tokens["text-on-brand-base"] = neutralAlpha[10]
  tokens["text-on-interactive-base"] = isDark ? neutral[11] : neutral[0]
  tokens["text-on-interactive-weak"] = neutralAlpha[10]
  tokens["text-on-success-base"] = success[isDark ? 8 : 9]
  tokens["text-on-critical-base"] = error[isDark ? 8 : 9]
  tokens["text-on-critical-weak"] = error[7]
  tokens["text-on-critical-strong"] = error[11]
  tokens["text-on-warning-base"] = neutralAlpha[10]
  tokens["text-on-info-base"] = neutralAlpha[10]
  tokens["text-diff-add-base"] = diffAdd[10]
  tokens["text-diff-delete-base"] = diffDelete[isDark ? 8 : 9]
  tokens["text-diff-delete-strong"] = diffDelete[11]
  tokens["text-diff-add-strong"] = diffAdd[isDark ? 7 : 11]
  tokens["text-on-info-weak"] = neutralAlpha[8]
  tokens["text-on-info-strong"] = neutralAlpha[11]
  tokens["text-on-warning-weak"] = neutralAlpha[8]
  tokens["text-on-warning-strong"] = neutralAlpha[11]
  tokens["text-on-success-weak"] = success[isDark ? 7 : 5]
  tokens["text-on-success-strong"] = success[11]
  tokens["text-on-brand-weak"] = neutralAlpha[8]
  tokens["text-on-brand-weaker"] = neutralAlpha[7]
  tokens["text-on-brand-strong"] = neutralAlpha[11]

  tokens["button-primary-base"] = neutral[11]
  tokens["button-secondary-base"] = noInk ? (isDark ? neutral[1] : neutral[0]) : isDark ? neutral[2] : neutral[0]
  tokens["button-secondary-hover"] = noInk ? (isDark ? neutral[1] : neutral[1]) : isDark ? neutral[3] : neutral[1]
  tokens["button-ghost-hover"] = neutralAlpha[1]
  tokens["button-ghost-hover2"] = neutralAlpha[2]

  if (noInk) {
    const tone = (alpha: number) => alphaTone((isDark ? "#ffffff" : "#000000") as HexColor, alpha)
    if (isDark) {
      tokens["surface-base"] = tone(0.031)
      tokens["surface-base-hover"] = tone(0.039)
      tokens["surface-base-active"] = tone(0.059)
      tokens["surface-raised-base"] = tone(0.059)
      tokens["surface-raised-base-hover"] = tone(0.078)
      tokens["surface-raised-base-active"] = tone(0.102)
      tokens["surface-raised-strong"] = tone(0.078)
      tokens["surface-raised-strong-hover"] = tone(0.129)
      tokens["surface-raised-stronger"] = tone(0.129)
      tokens["surface-raised-stronger-hover"] = tone(0.169)
      tokens["surface-weak"] = tone(0.078)
      tokens["surface-weaker"] = tone(0.102)
      tokens["surface-strong"] = tone(0.169)
      tokens["surface-raised-stronger-non-alpha"] = neutral[1]
      tokens["surface-inset-base"] = withAlpha("#000000", 0.5) as ColorValue
      tokens["surface-inset-base-hover"] = tokens["surface-inset-base"]
      tokens["surface-inset-strong"] = withAlpha("#000000", 0.8) as ColorValue
      tokens["surface-inset-strong-hover"] = tokens["surface-inset-strong"]
      tokens["button-secondary-hover"] = tone(0.039)
      tokens["button-ghost-hover"] = tone(0.031)
      tokens["button-ghost-hover2"] = tone(0.059)
      tokens["input-base"] = neutral[1]
      tokens["input-hover"] = neutral[1]
      tokens["input-selected"] = interactive[1]
      tokens["surface-diff-skip-base"] = "#00000000"
    }

    if (!isDark) {
      tokens["surface-base"] = tone(0.031)
      tokens["surface-base-hover"] = tone(0.059)
      tokens["surface-base-active"] = tone(0.051)
      tokens["surface-raised-base"] = tone(0.031)
      tokens["surface-raised-base-hover"] = tone(0.051)
      tokens["surface-raised-base-active"] = tone(0.09)
      tokens["surface-raised-strong"] = neutral[0]
      tokens["surface-raised-strong-hover"] = "#ffffff"
      tokens["surface-raised-stronger"] = "#ffffff"
      tokens["surface-raised-stronger-hover"] = "#ffffff"
      tokens["surface-weak"] = tone(0.051)
      tokens["surface-weaker"] = tone(0.071)
      tokens["surface-strong"] = "#ffffff"
      tokens["surface-raised-stronger-non-alpha"] = "#ffffff"
      tokens["surface-inset-strong"] = tone(0.09)
      tokens["surface-inset-strong-hover"] = tokens["surface-inset-strong"]
      tokens["button-secondary-hover"] = blend("#ffffff", background, 0.04)
      tokens["button-ghost-hover"] = tone(0.031)
      tokens["button-ghost-hover2"] = tone(0.051)
      tokens["input-base"] = neutral[0]
      tokens["input-hover"] = neutral[1]
    }

    tokens["surface-base-interactive-active"] = withAlpha(colors.interactive, isDark ? 0.125 : 0.09) as ColorValue
  }

  tokens["border-base"] = hasInk ? borderTone(0.22, 0.16) : neutralAlpha[6]
  tokens["border-hover"] = hasInk ? borderTone(0.28, 0.2) : neutralAlpha[7]
  tokens["border-active"] = hasInk ? borderTone(0.34, 0.24) : neutralAlpha[8]
  tokens["border-selected"] = noInk
    ? isDark
      ? interactive[10]
      : (withAlpha(colors.interactive, 0.99) as ColorValue)
    : (withAlpha(interactive[8], isDark ? 0.9 : 0.99) as ColorValue)
  tokens["border-disabled"] = hasInk ? borderTone(0.18, 0.12) : neutralAlpha[7]
  tokens["border-focus"] = hasInk ? borderTone(0.34, 0.24) : neutralAlpha[8]
  tokens["border-weak-base"] = hasInk
    ? borderTone(0.1, 0.08)
    : noInk
      ? isDark
        ? neutral[3]
        : blend(neutral[4], neutral[5], 0.5)
      : neutralAlpha[isDark ? 5 : 4]
  tokens["border-strong-base"] = hasInk ? borderTone(0.34, 0.24) : neutralAlpha[isDark ? 7 : 6]
  tokens["border-strong-hover"] = hasInk ? borderTone(0.4, 0.28) : neutralAlpha[7]
  tokens["border-strong-active"] = hasInk ? borderTone(0.46, 0.32) : neutralAlpha[isDark ? 7 : 6]
  tokens["border-strong-selected"] = noInk
    ? (withAlpha(colors.interactive, isDark ? 0.62 : 0.31) as ColorValue)
    : (withAlpha(interactive[5], 0.6) as ColorValue)
  tokens["border-strong-disabled"] = hasInk ? borderTone(0.14, 0.1) : neutralAlpha[5]
  tokens["border-strong-focus"] = hasInk ? borderTone(0.46, 0.32) : neutralAlpha[isDark ? 7 : 6]
  tokens["border-weak-hover"] = hasInk ? borderTone(0.16, 0.12) : neutralAlpha[isDark ? 6 : 5]
  tokens["border-weak-active"] = hasInk ? borderTone(0.22, 0.16) : neutralAlpha[isDark ? 7 : 6]
  tokens["border-weak-selected"] = noInk
    ? (withAlpha(colors.interactive, isDark ? 0.62 : 0.24) as ColorValue)
    : (withAlpha(interactive[4], isDark ? 0.6 : 0.5) as ColorValue)
  tokens["border-weak-disabled"] = hasInk ? borderTone(0.08, 0.06) : neutralAlpha[5]
  tokens["border-weak-focus"] = hasInk ? borderTone(0.22, 0.16) : neutralAlpha[isDark ? 7 : 6]
  tokens["border-weaker-base"] = hasInk
    ? borderTone(0.06, 0.04)
    : noInk
      ? isDark
        ? blend(neutral[1], neutral[2], 0.5)
        : blend(neutral[2], neutral[3], 0.5)
      : neutralAlpha[2]

  if (noInk) {
    const line = (l: number, d: number) => alphaTone((isDark ? "#ffffff" : "#000000") as HexColor, isDark ? d : l)
    tokens["border-base"] = line(0.162, 0.195)
    tokens["border-hover"] = line(0.236, 0.284)
    tokens["border-active"] = line(0.46, 0.418)
    tokens["border-disabled"] = tokens["border-hover"]
    tokens["border-focus"] = tokens["border-active"]
  }

  tokens["border-interactive-base"] = (noInk && isDark ? interl : interactive)[6]
  tokens["border-interactive-hover"] = (noInk && isDark ? interl : interactive)[7]
  tokens["border-interactive-active"] = (noInk && isDark ? interl : interactive)[8]
  tokens["border-interactive-selected"] = (noInk && isDark ? interl : interactive)[8]
  tokens["border-interactive-disabled"] = neutral[7]
  tokens["border-interactive-focus"] = (noInk && isDark ? interl : interactive)[8]

  tokens["border-success-base"] = (noInk && isDark ? successl : success)[5]
  tokens["border-success-hover"] = (noInk && isDark ? successl : success)[6]
  tokens["border-success-selected"] = (noInk && isDark ? successl : success)[8]
  tokens["border-warning-base"] = (noInk && isDark ? warningl : warning)[5]
  tokens["border-warning-hover"] = (noInk && isDark ? warningl : warning)[6]
  tokens["border-warning-selected"] = (noInk && isDark ? warningl : warning)[8]
  tokens["border-critical-base"] = error[isDark ? 4 : 5]
  tokens["border-critical-hover"] = error[6]
  tokens["border-critical-selected"] = error[8]
  tokens["border-info-base"] = (noInk && isDark ? infol : info)[5]
  tokens["border-info-hover"] = (noInk && isDark ? infol : info)[6]
  tokens["border-info-selected"] = (noInk && isDark ? infol : info)[8]
  tokens["border-color"] = "#ffffff"

  tokens["icon-base"] = hasInk && !isDark ? tokens["text-weak"] : neutral[isDark ? 9 : 8]
  tokens["icon-hover"] = hasInk && !isDark ? tokens["text-base"] : neutral[10]
  tokens["icon-active"] = hasInk && !isDark ? tokens["text-strong"] : neutral[11]
  tokens["icon-selected"] = hasInk && !isDark ? tokens["text-strong"] : neutral[11]
  tokens["icon-disabled"] = neutral[isDark ? 6 : 7]
  tokens["icon-focus"] = hasInk && !isDark ? tokens["text-strong"] : neutral[11]
  tokens["icon-invert-base"] = isDark ? neutral[0] : "#ffffff"
  tokens["icon-weak-base"] = neutral[isDark ? 5 : 6]
  tokens["icon-weak-hover"] = noInk && isDark ? blend(neutral[11], neutral[10], 0.74) : neutral[isDark ? 11 : 7]
  tokens["icon-weak-active"] = noInk && isDark ? blend(neutral[11], neutral[10], 0.52) : neutral[8]
  tokens["icon-weak-selected"] = neutral[isDark ? 8 : 9]
  tokens["icon-weak-disabled"] = noInk && isDark ? neutral[11] : neutral[isDark ? 3 : 5]
  tokens["icon-weak-focus"] = neutral[8]
  tokens["icon-strong-base"] = neutral[11]
  tokens["icon-strong-hover"] = isDark ? "#f6f3f3" : "#151313"
  tokens["icon-strong-active"] = isDark ? "#fcfcfc" : "#020202"
  tokens["icon-strong-selected"] = isDark ? "#fdfcfc" : "#020202"
  tokens["icon-strong-disabled"] = noInk && isDark ? neutral[6] : neutral[7]
  tokens["icon-strong-focus"] = isDark ? "#fdfcfc" : "#020202"
  tokens["icon-brand-base"] = isDark ? "#ffffff" : neutral[11]
  tokens["icon-interactive-base"] = interactive[8]
  tokens["icon-success-base"] = success[isDark ? 8 : 6]
  tokens["icon-success-hover"] = success[isDark ? 9 : 7]
  tokens["icon-success-active"] = success[10]
  tokens["icon-warning-base"] = amber[isDark ? 8 : 6]
  tokens["icon-warning-hover"] = amber[7]
  tokens["icon-warning-active"] = amber[10]
  tokens["icon-critical-base"] = error[isDark ? 8 : 9]
  tokens["icon-critical-hover"] = error[10]
  tokens["icon-critical-active"] = error[11]
  tokens["icon-info-base"] = info[isDark ? 6 : 6]
  tokens["icon-info-hover"] = info[7]
  tokens["icon-info-active"] = info[10]
  tokens["icon-on-brand-base"] = neutralAlpha[10]
  tokens["icon-on-brand-hover"] = neutralAlpha[11]
  tokens["icon-on-brand-selected"] = neutralAlpha[11]
  tokens["icon-on-interactive-base"] = isDark ? neutral[11] : neutral[0]

  tokens["icon-agent-plan-base"] = info[8]
  tokens["icon-agent-docs-base"] = amber[8]
  tokens["icon-agent-ask-base"] = blue[8]
  tokens["icon-agent-build-base"] = interactive[isDark ? 10 : 8]

  tokens["icon-on-success-base"] = withAlpha(success[8], 0.9) as ColorValue
  tokens["icon-on-success-hover"] = withAlpha(success[9], 0.9) as ColorValue
  tokens["icon-on-success-selected"] = withAlpha(success[10], 0.9) as ColorValue
  tokens["icon-on-warning-base"] = withAlpha(amber[8], 0.9) as ColorValue
  tokens["icon-on-warning-hover"] = withAlpha(amber[9], 0.9) as ColorValue
  tokens["icon-on-warning-selected"] = withAlpha(amber[10], 0.9) as ColorValue
  tokens["icon-on-critical-base"] = withAlpha(error[8], 0.9) as ColorValue
  tokens["icon-on-critical-hover"] = withAlpha(error[9], 0.9) as ColorValue
  tokens["icon-on-critical-selected"] = withAlpha(error[10], 0.9) as ColorValue
  tokens["icon-on-info-base"] = info[8]
  tokens["icon-on-info-hover"] = withAlpha(info[9], 0.9) as ColorValue
  tokens["icon-on-info-selected"] = withAlpha(info[10], 0.9) as ColorValue

  tokens["icon-diff-add-base"] = diffAdd[10]
  tokens["icon-diff-add-hover"] = diffAdd[isDark ? 9 : 11]
  tokens["icon-diff-add-active"] = diffAdd[isDark ? 10 : 11]
  tokens["icon-diff-delete-base"] = diffDelete[isDark ? 8 : 9]
  tokens["icon-diff-delete-hover"] = diffDelete[isDark ? 9 : 10]
  tokens["icon-diff-modified-base"] = modified()

  if (colors.compact) {
    if (!hasInk) {
      tokens["syntax-comment"] = "var(--text-weak)"
      tokens["syntax-regexp"] = "var(--text-base)"
      tokens["syntax-string"] = isDark ? "#00ceb9" : "#006656"
      tokens["syntax-keyword"] = "var(--text-weak)"
      tokens["syntax-primitive"] = isDark ? "#ffba92" : "#fb4804"
      tokens["syntax-operator"] = isDark ? "var(--text-weak)" : "var(--text-base)"
      tokens["syntax-variable"] = "var(--text-strong)"
      tokens["syntax-property"] = isDark ? "#ff9ae2" : "#ed6dc8"
      tokens["syntax-type"] = isDark ? "#ecf58c" : "#596600"
      tokens["syntax-constant"] = isDark ? "#93e9f6" : "#007b80"
      tokens["syntax-punctuation"] = isDark ? "var(--text-weak)" : "var(--text-base)"
      tokens["syntax-object"] = "var(--text-strong)"
      tokens["syntax-success"] = success[9]
      tokens["syntax-warning"] = amber[9]
      tokens["syntax-critical"] = error[9]
      tokens["syntax-info"] = isDark ? "#93e9f6" : "#0092a8"
      tokens["syntax-diff-add"] = diffAdd[10]
      tokens["syntax-diff-delete"] = diffDelete[10]
      tokens["syntax-diff-unknown"] = "#ff0000"

      tokens["markdown-heading"] = isDark ? "#9d7cd8" : "#d68c27"
      tokens["markdown-text"] = isDark ? "#eeeeee" : "#1a1a1a"
      tokens["markdown-link"] = isDark ? "#fab283" : "#3b7dd8"
      tokens["markdown-link-text"] = isDark ? "#56b6c2" : "#318795"
      tokens["markdown-code"] = isDark ? "#7fd88f" : "#3d9a57"
      tokens["markdown-block-quote"] = isDark ? "#e5c07b" : "#b0851f"
      tokens["markdown-emph"] = isDark ? "#e5c07b" : "#b0851f"
      tokens["markdown-strong"] = isDark ? "#f5a742" : "#d68c27"
      tokens["markdown-horizontal-rule"] = isDark ? "#808080" : "#8a8a8a"
      tokens["markdown-list-item"] = isDark ? "#fab283" : "#3b7dd8"
      tokens["markdown-list-enumeration"] = isDark ? "#56b6c2" : "#318795"
      tokens["markdown-image"] = isDark ? "#fab283" : "#3b7dd8"
      tokens["markdown-image-text"] = isDark ? "#56b6c2" : "#318795"
      tokens["markdown-code-block"] = isDark ? "#eeeeee" : "#1a1a1a"
    }

    if (hasInk) {
      tokens["syntax-comment"] = "var(--text-weak)"
      tokens["syntax-regexp"] = "var(--text-base)"
      tokens["syntax-string"] = content(colors.success, success)
      tokens["syntax-keyword"] = "var(--text-weak)"
      tokens["syntax-primitive"] = content(colors.accent, accent)
      tokens["syntax-operator"] = isDark ? "var(--text-weak)" : "var(--text-base)"
      tokens["syntax-variable"] = "var(--text-strong)"
      tokens["syntax-property"] = content(colors.primary, primary)
      tokens["syntax-type"] = content(colors.warning, warning)
      tokens["syntax-constant"] = content(colors.info, info)
      tokens["syntax-punctuation"] = isDark ? "var(--text-weak)" : "var(--text-base)"
      tokens["syntax-object"] = "var(--text-strong)"
      tokens["syntax-success"] = success[9]
      tokens["syntax-warning"] = amber[9]
      tokens["syntax-critical"] = error[9]
      tokens["syntax-info"] = content(colors.info, info)
      tokens["syntax-diff-add"] = diffAdd[10]
      tokens["syntax-diff-delete"] = diffDelete[10]
      tokens["syntax-diff-unknown"] = "#ff0000"

      tokens["markdown-heading"] = content(colors.primary, primary)
      tokens["markdown-text"] = tokens["text-base"]
      tokens["markdown-link"] = content(colors.interactive, interactive)
      tokens["markdown-link-text"] = content(colors.info, info)
      tokens["markdown-code"] = content(colors.success, success)
      tokens["markdown-block-quote"] = content(colors.warning, warning)
      tokens["markdown-emph"] = content(colors.warning, warning)
      tokens["markdown-strong"] = content(colors.accent, accent)
      tokens["markdown-horizontal-rule"] = tokens["border-base"]
      tokens["markdown-list-item"] = content(colors.interactive, interactive)
      tokens["markdown-list-enumeration"] = content(colors.info, info)
      tokens["markdown-image"] = content(colors.interactive, interactive)
      tokens["markdown-image-text"] = content(colors.info, info)
      tokens["markdown-code-block"] = tokens["text-base"]
    }
  }

  if (!colors.compact) {
    tokens["syntax-comment"] = "var(--text-weak)"
    tokens["syntax-regexp"] = "var(--text-base)"
    tokens["syntax-string"] = isDark ? "#00ceb9" : "#006656"
    tokens["syntax-keyword"] = "var(--text-weak)"
    tokens["syntax-primitive"] = isDark ? "#ffba92" : "#fb4804"
    tokens["syntax-operator"] = isDark ? "var(--text-weak)" : "var(--text-base)"
    tokens["syntax-variable"] = "var(--text-strong)"
    tokens["syntax-property"] = isDark ? "#ff9ae2" : "#ed6dc8"
    tokens["syntax-type"] = isDark ? "#ecf58c" : "#596600"
    tokens["syntax-constant"] = isDark ? "#93e9f6" : "#007b80"
    tokens["syntax-punctuation"] = isDark ? "var(--text-weak)" : "var(--text-base)"
    tokens["syntax-object"] = "var(--text-strong)"
    tokens["syntax-success"] = success[9]
    tokens["syntax-warning"] = amber[9]
    tokens["syntax-critical"] = error[9]
    tokens["syntax-info"] = isDark ? "#93e9f6" : "#0092a8"
    tokens["syntax-diff-add"] = diffAdd[10]
    tokens["syntax-diff-delete"] = diffDelete[10]
    tokens["syntax-diff-unknown"] = "#ff0000"

    tokens["markdown-heading"] = isDark ? "#9d7cd8" : "#d68c27"
    tokens["markdown-text"] = isDark ? "#eeeeee" : "#1a1a1a"
    tokens["markdown-link"] = isDark ? "#fab283" : "#3b7dd8"
    tokens["markdown-link-text"] = isDark ? "#56b6c2" : "#318795"
    tokens["markdown-code"] = isDark ? "#7fd88f" : "#3d9a57"
    tokens["markdown-block-quote"] = isDark ? "#e5c07b" : "#b0851f"
    tokens["markdown-emph"] = isDark ? "#e5c07b" : "#b0851f"
    tokens["markdown-strong"] = isDark ? "#f5a742" : "#d68c27"
    tokens["markdown-horizontal-rule"] = isDark ? "#808080" : "#8a8a8a"
    tokens["markdown-list-item"] = isDark ? "#fab283" : "#3b7dd8"
    tokens["markdown-list-enumeration"] = isDark ? "#56b6c2" : "#318795"
    tokens["markdown-image"] = isDark ? "#fab283" : "#3b7dd8"
    tokens["markdown-image-text"] = isDark ? "#56b6c2" : "#318795"
    tokens["markdown-code-block"] = isDark ? "#eeeeee" : "#1a1a1a"
  }

  tokens["avatar-background-pink"] = isDark ? "#501b3f" : "#feeef8"
  tokens["avatar-background-mint"] = isDark ? "#033a34" : "#e1fbf4"
  tokens["avatar-background-orange"] = isDark ? "#5f2a06" : "#fff1e7"
  tokens["avatar-background-purple"] = isDark ? "#432155" : "#f9f1fe"
  tokens["avatar-background-cyan"] = isDark ? "#0f3058" : "#e7f9fb"
  tokens["avatar-background-lime"] = isDark ? "#2b3711" : "#eefadc"
  tokens["avatar-text-pink"] = isDark ? "#e34ba9" : "#cd1d8d"
  tokens["avatar-text-mint"] = isDark ? "#95f3d9" : "#147d6f"
  tokens["avatar-text-orange"] = isDark ? "#ff802b" : "#ed5f00"
  tokens["avatar-text-purple"] = isDark ? "#9d5bd2" : "#8445bc"
  tokens["avatar-text-cyan"] = isDark ? "#369eff" : "#0894b3"
  tokens["avatar-text-lime"] = isDark ? "#c4f042" : "#5d770d"

  for (const [key, value] of Object.entries(overrides)) {
    tokens[key] = value
  }

  if (hasInk && "text-weak" in overrides && !("text-weaker" in overrides)) {
    const weak = tokens["text-weak"]
    if (weak.startsWith("#")) {
      tokens["text-weaker"] = shift(weak as HexColor, { l: isDark ? -0.12 : 0.12, c: 0.75 })
    } else {
      tokens["text-weaker"] = weak
    }
  }

  if (colors.compact && hasInk) {
    if (!("markdown-text" in overrides)) {
      tokens["markdown-text"] = tokens["text-base"]
    }
    if (!("markdown-code-block" in overrides)) {
      tokens["markdown-code-block"] = tokens["text-base"]
    }
  }

  if (!("text-stronger" in overrides)) {
    tokens["text-stronger"] = tokens["text-strong"]
  }

  return tokens
}

interface ThemeColors {
  compact: boolean
  neutral: HexColor
  ink?: HexColor
  primary: HexColor
  accent: HexColor
  success: HexColor
  warning: HexColor
  error: HexColor
  info: HexColor
  interactive: HexColor
  diffAdd?: HexColor
  diffDelete?: HexColor
}

function getColors(variant: ThemeVariant): ThemeColors {
  const input = variant as { palette?: unknown; seeds?: unknown }
  if (input.palette && input.seeds) {
    throw new Error("Theme variant cannot define both `palette` and `seeds`")
  }

  if (variant.palette) {
    return {
      compact: true,
      neutral: variant.palette.neutral,
      ink: variant.palette.ink,
      primary: variant.palette.primary,
      accent: variant.palette.accent ?? variant.palette.info,
      success: variant.palette.success,
      warning: variant.palette.warning,
      error: variant.palette.error,
      info: variant.palette.info,
      interactive: variant.palette.interactive ?? variant.palette.primary,
      diffAdd: variant.palette.diffAdd,
      diffDelete: variant.palette.diffDelete,
    }
  }

  if (variant.seeds) {
    return {
      compact: false,
      neutral: variant.seeds.neutral,
      ink: undefined,
      primary: variant.seeds.primary,
      accent: variant.seeds.info,
      success: variant.seeds.success,
      warning: variant.seeds.warning,
      error: variant.seeds.error,
      info: variant.seeds.info,
      interactive: variant.seeds.interactive,
      diffAdd: variant.seeds.diffAdd,
      diffDelete: variant.seeds.diffDelete,
    }
  }

  throw new Error("Theme variant requires `palette` or `seeds`")
}

function generateNeutralOverlayScale(neutralScale: HexColor[], isDark: boolean): ColorValue[] {
  const alphas = isDark
    ? [0, 0.034, 0.063, 0.084, 0.109, 0.138, 0.181, 0.266, 0.404, 0.468, 0.603, 0.928]
    : [0.014, 0.034, 0.055, 0.075, 0.096, 0.118, 0.151, 0.232, 0.453, 0.492, 0.574, 0.915]
  const color = (isDark ? "#ffffff" : "#000000") as HexColor
  return alphas.map((alpha) => withAlpha(color, alpha) as ColorValue)
}

function generateNeutralAlphaScale(neutralScale: HexColor[], isDark: boolean): HexColor[] {
  const alphas = isDark
    ? [0.024, 0.048, 0.088, 0.128, 0.17, 0.215, 0.275, 0.38, 0.46, 0.54, 0.74, 0.95]
    : [0.014, 0.034, 0.066, 0.098, 0.128, 0.158, 0.208, 0.282, 0.47, 0.625, 0.515, 0.88]

  return neutralScale.map((hex, i) => {
    const baseOklch = hexToOklch(hex)
    const targetL = isDark ? 0.1 + alphas[i] * 0.8 : 1 - alphas[i] * 0.8
    return oklchToHex({
      ...baseOklch,
      l: baseOklch.l * alphas[i] + targetL * (1 - alphas[i]),
    })
  })
}

function getHex(value: ColorValue | undefined): HexColor | undefined {
  if (!value?.startsWith("#")) return
  return value as HexColor
}

export function resolveTheme(theme: DesktopTheme): { light: ResolvedTheme; dark: ResolvedTheme } {
  return {
    light: resolveThemeVariant(theme.light, false),
    dark: resolveThemeVariant(theme.dark, true),
  }
}

export function themeToCss(tokens: ResolvedTheme): string {
  return Object.entries(tokens)
    .map(([key, value]) => `--${key}: ${value};`)
    .join("\n  ")
}

import type { ColorValue, DesktopTheme, HexColor, ResolvedTheme, ThemeVariant } from "./types"
import { blend, generateNeutralScale, generateScale, hexToOklch, hexToRgb, shift, withAlpha } from "./color"

export function resolveThemeVariant(variant: ThemeVariant, isDark: boolean): ResolvedTheme {
  const colors = getColors(variant)
  const { overrides = {} } = variant

  const neutral = generateNeutralScale(colors.neutral, isDark, colors.ink)
  const primary = generateScale(colors.primary, isDark)
  const accent = generateScale(colors.accent, isDark)
  const success = generateScale(colors.success, isDark)
  const warning = generateScale(colors.warning, isDark)
  const error = generateScale(colors.error, isDark)
  const info = generateScale(colors.info, isDark)
  const interactive = generateScale(colors.interactive, isDark)
  const amber = generateScale(
    shift(colors.warning, isDark ? { h: -16, l: -0.058, c: 1.14 } : { h: -22, l: -0.082, c: 0.94 }),
    isDark,
  )
  const blue = generateScale(shift(colors.interactive, { h: -12, l: 0.128, c: 1.12 }), isDark)
  const diffAdd = generateScale(
    colors.diffAdd ?? shift(colors.success, { c: isDark ? 0.7 : 0.55, l: isDark ? -0.18 : 0.14 }),
    isDark,
  )
  const diffDelete = generateScale(
    colors.diffDelete ?? shift(colors.error, { c: isDark ? 0.82 : 0.7, l: isDark ? -0.08 : 0.08 }),
    isDark,
  )
  const ink = colors.ink ?? colors.neutral
  const tint = colors.compact ? hexToOklch(ink) : undefined
  const body = tint
    ? shift(ink, {
        l: isDark ? Math.max(0, 0.88 - tint.l) * 0.4 : -Math.max(0, tint.l - 0.18) * 0.24,
        c: isDark ? 1.04 : 1.02,
      })
    : undefined
  const backgroundOverride = overrides["background-base"]
  const backgroundHex = getHex(backgroundOverride)
  const overlay = Boolean(backgroundOverride) && !backgroundHex
  const content = (seed: HexColor, scale: HexColor[]) => {
    const base = hexToOklch(seed)
    const value = isDark ? (base.l > 0.84 ? shift(seed, { c: 1.18 }) : scale[10]) : scale[10]
    return shift(value, { l: isDark ? 0.034 : -0.024, c: isDark ? 1.3 : 1.18 })
  }
  const modified = () => {
    if (!colors.compact) return isDark ? "#ffba92" : "#FF8C00"
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
  const background = backgroundHex ?? neutral[0]
  const alphaTone = (color: HexColor, alpha: number) =>
    overlay ? (withAlpha(color, alpha) as ColorValue) : blend(color, background, alpha)
  const borderTone = (light: number, dark: number) =>
    alphaTone(ink, isDark ? Math.min(1, dark + 0.024 + (colors.compact ? 0.08 : 0)) : Math.min(1, light + 0.024))
  const diffHiddenSurface = surface(
    isDark ? shift(colors.interactive, { c: 0.55, l: 0 }) : shift(colors.interactive, { c: 0.45, l: 0.08 }),
    isDark
      ? { base: 0.14, weak: 0.08, weaker: 0.18, strong: 0.26, stronger: 0.42 }
      : { base: 0.12, weak: 0.08, weaker: 0.16, strong: 0.24, stronger: 0.36 },
  )

  const neutralAlpha = generateNeutralAlphaScale(neutral, isDark)
  const brandb = primary[8]
  const brandh = primary[9]
  const interb = interactive[isDark ? 6 : 4]
  const interh = interactive[isDark ? 7 : 5]
  const interw = interactive[isDark ? 5 : 3]
  const succb = success[isDark ? 6 : 4]
  const succw = success[isDark ? 5 : 3]
  const succs = success[10]
  const warnb = warning[isDark ? 6 : 4]
  const warnw = warning[isDark ? 5 : 3]
  const warns = warning[10]
  const critb = error[isDark ? 6 : 4]
  const critw = error[isDark ? 5 : 3]
  const crits = error[10]
  const infob = info[isDark ? 6 : 4]
  const infow = info[isDark ? 5 : 3]
  const infos = info[10]
  const lum = (hex: HexColor) => {
    const rgb = hexToRgb(hex)
    const lift = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
    return 0.2126 * lift(rgb.r) + 0.7152 * lift(rgb.g) + 0.0722 * lift(rgb.b)
  }
  const hit = (a: HexColor, b: HexColor) => {
    const x = lum(a)
    const y = lum(b)
    const light = Math.max(x, y)
    const dark = Math.min(x, y)
    return (light + 0.05) / (dark + 0.05)
  }
  const on = (fill: HexColor) => {
    const light = "#ffffff" as HexColor
    const dark = "#000000" as HexColor
    return hit(light, fill) > hit(dark, fill) ? light : dark
  }

  const tokens: ResolvedTheme = {}

  tokens["background-base"] = neutral[0]
  tokens["background-weak"] = neutral[2]
  tokens["background-strong"] = neutral[0]
  tokens["background-stronger"] = isDark ? neutral[1] : "#fcfcfc"

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
  tokens["surface-float-base"] = isDark ? neutral[1] : neutral[11]
  tokens["surface-float-base-hover"] = isDark ? neutral[2] : neutral[10]
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

  tokens["surface-brand-base"] = brandb
  tokens["surface-brand-hover"] = brandh

  tokens["surface-interactive-base"] = interb
  tokens["surface-interactive-hover"] = interh
  tokens["surface-interactive-weak"] = interw
  tokens["surface-interactive-weak-hover"] = interb

  tokens["surface-success-base"] = succb
  tokens["surface-success-weak"] = succw
  tokens["surface-success-strong"] = succs
  tokens["surface-warning-base"] = warnb
  tokens["surface-warning-weak"] = warnw
  tokens["surface-warning-strong"] = warns
  tokens["surface-critical-base"] = critb
  tokens["surface-critical-weak"] = critw
  tokens["surface-critical-strong"] = crits
  tokens["surface-info-base"] = infob
  tokens["surface-info-weak"] = infow
  tokens["surface-info-strong"] = infos

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
  tokens["input-hover"] = isDark ? neutral[2] : neutral[1]
  tokens["input-active"] = isDark ? interactive[6] : interactive[0]
  tokens["input-selected"] = isDark ? interactive[7] : interactive[3]
  tokens["input-focus"] = isDark ? interactive[6] : interactive[0]
  tokens["input-disabled"] = neutral[3]

  tokens["text-base"] = colors.compact ? (body as HexColor) : neutral[10]
  tokens["text-weak"] = colors.compact ? shift(body as HexColor, { l: isDark ? -0.11 : 0.11, c: 0.9 }) : neutral[8]
  tokens["text-weaker"] = colors.compact
    ? shift(body as HexColor, { l: isDark ? -0.2 : 0.21, c: isDark ? 0.78 : 0.72 })
    : neutral[7]
  tokens["text-strong"] = colors.compact
    ? isDark
      ? blend("#ffffff", body as HexColor, 0.9)
      : shift(body as HexColor, { l: -0.07, c: 1.04 })
    : neutral[11]
  tokens["text-invert-base"] = isDark ? neutral[10] : neutral[1]
  tokens["text-invert-weak"] = isDark ? neutral[8] : neutral[2]
  tokens["text-invert-weaker"] = isDark ? neutral[7] : neutral[3]
  tokens["text-invert-strong"] = isDark ? neutral[11] : neutral[0]
  tokens["text-interactive-base"] = interactive[isDark ? 10 : 9]
  tokens["text-on-brand-base"] = on(brandb)
  tokens["text-on-interactive-base"] = on(interb)
  tokens["text-on-interactive-weak"] = on(interb)
  tokens["text-on-success-base"] = on(succb)
  tokens["text-on-critical-base"] = on(critb)
  tokens["text-on-critical-weak"] = on(critb)
  tokens["text-on-critical-strong"] = on(crits)
  tokens["text-on-warning-base"] = on(warnb)
  tokens["text-on-info-base"] = on(infob)
  tokens["text-diff-add-base"] = diffAdd[10]
  tokens["text-diff-delete-base"] = diffDelete[9]
  tokens["text-diff-delete-strong"] = diffDelete[11]
  tokens["text-diff-add-strong"] = diffAdd[isDark ? 7 : 11]
  tokens["text-on-info-weak"] = on(infob)
  tokens["text-on-info-strong"] = on(infos)
  tokens["text-on-warning-weak"] = on(warnb)
  tokens["text-on-warning-strong"] = on(warns)
  tokens["text-on-success-weak"] = on(succb)
  tokens["text-on-success-strong"] = on(succs)
  tokens["text-on-brand-weak"] = on(brandb)
  tokens["text-on-brand-weaker"] = on(brandb)
  tokens["text-on-brand-strong"] = on(brandh)

  tokens["button-primary-base"] = neutral[11]
  tokens["button-secondary-base"] = isDark ? neutral[2] : neutral[0]
  tokens["button-secondary-hover"] = isDark ? neutral[3] : neutral[1]
  tokens["button-ghost-hover"] = neutralAlpha[1]
  tokens["button-ghost-hover2"] = neutralAlpha[2]

  tokens["border-base"] = colors.compact ? borderTone(0.22, 0.16) : neutralAlpha[6]
  tokens["border-hover"] = colors.compact ? borderTone(0.28, 0.2) : neutralAlpha[7]
  tokens["border-active"] = colors.compact ? borderTone(0.34, 0.24) : neutralAlpha[8]
  tokens["border-selected"] = withAlpha(interactive[8], isDark ? 0.9 : 0.99) as ColorValue
  tokens["border-disabled"] = colors.compact ? borderTone(0.18, 0.12) : neutralAlpha[7]
  tokens["border-focus"] = colors.compact ? borderTone(0.34, 0.24) : neutralAlpha[8]
  tokens["border-weak-base"] = colors.compact ? borderTone(0.1, 0.08) : neutralAlpha[isDark ? 5 : 4]
  tokens["border-strong-base"] = colors.compact ? borderTone(0.34, 0.24) : neutralAlpha[isDark ? 7 : 6]
  tokens["border-strong-hover"] = colors.compact ? borderTone(0.4, 0.28) : neutralAlpha[7]
  tokens["border-strong-active"] = colors.compact ? borderTone(0.46, 0.32) : neutralAlpha[isDark ? 7 : 6]
  tokens["border-strong-selected"] = withAlpha(interactive[5], 0.6) as ColorValue
  tokens["border-strong-disabled"] = colors.compact ? borderTone(0.14, 0.1) : neutralAlpha[5]
  tokens["border-strong-focus"] = colors.compact ? borderTone(0.46, 0.32) : neutralAlpha[isDark ? 7 : 6]
  tokens["border-weak-hover"] = colors.compact ? borderTone(0.16, 0.12) : neutralAlpha[isDark ? 6 : 5]
  tokens["border-weak-active"] = colors.compact ? borderTone(0.22, 0.16) : neutralAlpha[isDark ? 7 : 6]
  tokens["border-weak-selected"] = withAlpha(interactive[4], isDark ? 0.6 : 0.5) as ColorValue
  tokens["border-weak-disabled"] = colors.compact ? borderTone(0.08, 0.06) : neutralAlpha[5]
  tokens["border-weak-focus"] = colors.compact ? borderTone(0.22, 0.16) : neutralAlpha[isDark ? 7 : 6]
  tokens["border-weaker-base"] = colors.compact ? borderTone(0.06, 0.04) : neutralAlpha[2]

  tokens["border-interactive-base"] = interactive[6]
  tokens["border-interactive-hover"] = interactive[7]
  tokens["border-interactive-active"] = interactive[8]
  tokens["border-interactive-selected"] = interactive[8]
  tokens["border-interactive-disabled"] = neutral[7]
  tokens["border-interactive-focus"] = interactive[8]

  tokens["border-success-base"] = success[isDark ? 6 : 6]
  tokens["border-success-hover"] = success[isDark ? 7 : 7]
  tokens["border-success-selected"] = success[8]
  tokens["border-warning-base"] = warning[isDark ? 6 : 6]
  tokens["border-warning-hover"] = warning[isDark ? 7 : 7]
  tokens["border-warning-selected"] = warning[8]
  tokens["border-critical-base"] = error[isDark ? 6 : 6]
  tokens["border-critical-hover"] = error[isDark ? 7 : 7]
  tokens["border-critical-selected"] = error[8]
  tokens["border-info-base"] = info[isDark ? 6 : 6]
  tokens["border-info-hover"] = info[isDark ? 7 : 7]
  tokens["border-info-selected"] = info[8]
  tokens["border-color"] = "#ffffff"

  tokens["icon-base"] = colors.compact && !isDark ? tokens["text-weak"] : neutral[isDark ? 9 : 8]
  tokens["icon-hover"] = colors.compact && !isDark ? tokens["text-base"] : neutral[10]
  tokens["icon-active"] = colors.compact && !isDark ? tokens["text-strong"] : neutral[11]
  tokens["icon-selected"] = colors.compact && !isDark ? tokens["text-strong"] : neutral[11]
  tokens["icon-disabled"] = neutral[isDark ? 6 : 7]
  tokens["icon-focus"] = colors.compact && !isDark ? tokens["text-strong"] : neutral[11]
  tokens["icon-invert-base"] = isDark ? neutral[0] : "#ffffff"
  tokens["icon-weak-base"] = neutral[isDark ? 5 : 6]
  tokens["icon-weak-hover"] = neutral[isDark ? 11 : 7]
  tokens["icon-weak-active"] = neutral[8]
  tokens["icon-weak-selected"] = neutral[isDark ? 8 : 9]
  tokens["icon-weak-disabled"] = neutral[isDark ? 3 : 5]
  tokens["icon-weak-focus"] = neutral[8]
  tokens["icon-strong-base"] = neutral[11]
  tokens["icon-strong-hover"] = isDark ? "#f6f3f3" : "#151313"
  tokens["icon-strong-active"] = isDark ? "#fcfcfc" : "#020202"
  tokens["icon-strong-selected"] = isDark ? "#fdfcfc" : "#020202"
  tokens["icon-strong-disabled"] = neutral[7]
  tokens["icon-strong-focus"] = isDark ? "#fdfcfc" : "#020202"
  tokens["icon-brand-base"] = isDark ? "#ffffff" : neutral[11]
  tokens["icon-interactive-base"] = interactive[8]
  tokens["icon-success-base"] = success[isDark ? 8 : 6]
  tokens["icon-success-hover"] = success[9]
  tokens["icon-success-active"] = success[10]
  tokens["icon-warning-base"] = amber[isDark ? 8 : 6]
  tokens["icon-warning-hover"] = amber[9]
  tokens["icon-warning-active"] = amber[10]
  tokens["icon-critical-base"] = error[isDark ? 8 : 9]
  tokens["icon-critical-hover"] = error[9]
  tokens["icon-critical-active"] = error[10]
  tokens["icon-info-base"] = info[isDark ? 8 : 6]
  tokens["icon-info-hover"] = info[isDark ? 9 : 7]
  tokens["icon-info-active"] = info[10]
  tokens["icon-on-brand-base"] = on(brandb)
  tokens["icon-on-brand-hover"] = on(brandh)
  tokens["icon-on-brand-selected"] = on(brandh)
  tokens["icon-on-interactive-base"] = on(interb)

  tokens["icon-agent-plan-base"] = info[8]
  tokens["icon-agent-docs-base"] = amber[8]
  tokens["icon-agent-ask-base"] = blue[8]
  tokens["icon-agent-build-base"] = interactive[isDark ? 10 : 8]

  tokens["icon-on-success-base"] = on(succb)
  tokens["icon-on-success-hover"] = on(succs)
  tokens["icon-on-success-selected"] = on(succs)
  tokens["icon-on-warning-base"] = on(warnb)
  tokens["icon-on-warning-hover"] = on(warns)
  tokens["icon-on-warning-selected"] = on(warns)
  tokens["icon-on-critical-base"] = on(critb)
  tokens["icon-on-critical-hover"] = on(crits)
  tokens["icon-on-critical-selected"] = on(crits)
  tokens["icon-on-info-base"] = on(infob)
  tokens["icon-on-info-hover"] = on(infos)
  tokens["icon-on-info-selected"] = on(infos)

  tokens["icon-diff-add-base"] = diffAdd[10]
  tokens["icon-diff-add-hover"] = diffAdd[isDark ? 9 : 11]
  tokens["icon-diff-add-active"] = diffAdd[isDark ? 10 : 11]
  tokens["icon-diff-delete-base"] = diffDelete[9]
  tokens["icon-diff-delete-hover"] = diffDelete[isDark ? 10 : 10]
  tokens["icon-diff-modified-base"] = modified()

  if (colors.compact) {
    tokens["syntax-comment"] = "var(--text-weak)"
    tokens["syntax-regexp"] = "var(--text-base)"
    tokens["syntax-string"] = content(colors.success, success)
    tokens["syntax-keyword"] = content(colors.accent, accent)
    tokens["syntax-primitive"] = content(colors.primary, primary)
    tokens["syntax-operator"] = isDark ? "var(--text-weak)" : "var(--text-base)"
    tokens["syntax-variable"] = "var(--text-strong)"
    tokens["syntax-property"] = content(colors.info, info)
    tokens["syntax-type"] = content(colors.warning, warning)
    tokens["syntax-constant"] = content(colors.accent, accent)
    tokens["syntax-punctuation"] = isDark ? "var(--text-weak)" : "var(--text-base)"
    tokens["syntax-object"] = "var(--text-strong)"
    tokens["syntax-success"] = success[10]
    tokens["syntax-warning"] = amber[10]
    tokens["syntax-critical"] = error[10]
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
    tokens["syntax-success"] = success[10]
    tokens["syntax-warning"] = amber[10]
    tokens["syntax-critical"] = error[10]
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

  if (colors.compact && "text-weak" in overrides && !("text-weaker" in overrides)) {
    const weak = tokens["text-weak"]
    if (weak.startsWith("#")) {
      tokens["text-weaker"] = shift(weak as HexColor, { l: isDark ? -0.12 : 0.12, c: 0.75 })
    } else {
      tokens["text-weaker"] = weak
    }
  }

  if (colors.compact) {
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

function generateNeutralAlphaScale(neutralScale: HexColor[], isDark: boolean): HexColor[] {
  const alphas = isDark
    ? [0.038, 0.066, 0.1, 0.142, 0.19, 0.252, 0.334, 0.446, 0.58, 0.718, 0.854, 0.985]
    : [0.03, 0.06, 0.1, 0.145, 0.2, 0.265, 0.35, 0.47, 0.61, 0.74, 0.86, 0.97]

  return alphas.map((alpha) => blend(neutralScale[11], neutralScale[0], alpha))
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

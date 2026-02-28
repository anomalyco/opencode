import { generateNeutralScale, generateScale, hexToOklch, hexToRgb, oklchToHex, withAlpha } from "./color"
import type { ColorValue, DesktopTheme, HexColor, ResolvedTheme, ThemeVariant } from "./types"

export function resolveThemeVariant(variant: ThemeVariant, isDark: boolean): ResolvedTheme {
  const { seeds, overrides = {} } = variant

  const neutral = generateNeutralScale(seeds.neutral, isDark)
  const primary = generateScale(seeds.primary, isDark)
  const success = generateScale(seeds.success, isDark)
  const warning = generateScale(seeds.warning, isDark)
  const error = generateScale(seeds.error, isDark)
  const info = generateScale(seeds.info, isDark)
  const interactive = generateScale(seeds.interactive, isDark)
  const diffAdd = generateScale(seeds.diffAdd, isDark)
  const diffDelete = generateScale(seeds.diffDelete, isDark)

  // Accent seeds with fallbacks
  const accentSeed = seeds.accent ?? seeds.interactive
  const accentSecondarySeed = seeds.accentSecondary ?? seeds.info
  const accentTertiarySeed = seeds.accentTertiary ?? seeds.warning
  const accent = generateScale(accentSeed, isDark)
  const accentSecondary = generateScale(accentSecondarySeed, isDark)
  const accentTertiary = generateScale(accentTertiarySeed, isDark)

  const neutralAlpha = generateNeutralAlphaScale(neutral, isDark)

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
  tokens["surface-float-base"] = isDark ? neutral[0] : neutral[11]
  tokens["surface-float-base-hover"] = isDark ? neutral[1] : neutral[10]
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

  tokens["surface-brand-base"] = primary[8]
  tokens["surface-brand-hover"] = primary[9]

  tokens["surface-interactive-base"] = interactive[2]
  tokens["surface-interactive-hover"] = interactive[3]
  tokens["surface-interactive-weak"] = interactive[1]
  tokens["surface-interactive-weak-hover"] = interactive[2]

  tokens["surface-success-base"] = success[2]
  tokens["surface-success-weak"] = success[1]
  tokens["surface-success-strong"] = success[8]
  tokens["surface-warning-base"] = warning[2]
  tokens["surface-warning-weak"] = warning[1]
  tokens["surface-warning-strong"] = warning[8]
  tokens["surface-critical-base"] = error[2]
  tokens["surface-critical-weak"] = error[1]
  tokens["surface-critical-strong"] = error[8]
  tokens["surface-info-base"] = info[2]
  tokens["surface-info-weak"] = info[1]
  tokens["surface-info-strong"] = info[8]

  tokens["surface-diff-unchanged-base"] = isDark ? neutral[0] : "#ffffff00"
  tokens["surface-diff-skip-base"] = isDark ? neutralAlpha[0] : neutral[1]
  tokens["surface-diff-hidden-base"] = interactive[isDark ? 1 : 2]
  tokens["surface-diff-hidden-weak"] = interactive[isDark ? 0 : 1]
  tokens["surface-diff-hidden-weaker"] = interactive[isDark ? 2 : 0]
  tokens["surface-diff-hidden-strong"] = interactive[4]
  tokens["surface-diff-hidden-stronger"] = interactive[isDark ? 10 : 8]
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

  tokens["text-base"] = neutral[10]
  tokens["text-weak"] = neutral[8]
  tokens["text-weaker"] = neutral[7]
  tokens["text-strong"] = neutral[11]
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

  tokens["button-secondary-base"] = isDark ? neutral[2] : neutral[0]
  tokens["button-secondary-hover"] = isDark ? neutral[3] : neutral[1]
  tokens["button-ghost-hover"] = neutralAlpha[1]
  tokens["button-ghost-hover2"] = neutralAlpha[2]

  tokens["border-base"] = neutralAlpha[6]
  tokens["border-hover"] = neutralAlpha[7]
  tokens["border-active"] = neutralAlpha[8]
  tokens["border-selected"] = withAlpha(interactive[8], isDark ? 0.9 : 0.99) as ColorValue
  tokens["border-disabled"] = neutralAlpha[7]
  tokens["border-focus"] = neutralAlpha[8]
  tokens["border-weak-base"] = neutralAlpha[isDark ? 5 : 4]
  tokens["border-strong-base"] = neutralAlpha[isDark ? 7 : 6]
  tokens["border-strong-hover"] = neutralAlpha[7]
  tokens["border-strong-active"] = neutralAlpha[isDark ? 7 : 6]
  tokens["border-strong-selected"] = withAlpha(interactive[5], 0.6) as ColorValue
  tokens["border-strong-disabled"] = neutralAlpha[5]
  tokens["border-strong-focus"] = neutralAlpha[isDark ? 7 : 6]
  tokens["border-weak-hover"] = neutralAlpha[isDark ? 6 : 5]
  tokens["border-weak-active"] = neutralAlpha[isDark ? 7 : 6]
  tokens["border-weak-selected"] = withAlpha(interactive[4], isDark ? 0.6 : 0.5) as ColorValue
  tokens["border-weak-disabled"] = neutralAlpha[5]
  tokens["border-weak-focus"] = neutralAlpha[isDark ? 7 : 6]
  tokens["border-weaker-base"] = neutralAlpha[2]
  tokens["border-weaker-hover"] = neutralAlpha[3]
  tokens["border-weaker-active"] = neutralAlpha[5]
  tokens["border-weaker-selected"] = withAlpha(interactive[3], isDark ? 0.3 : 0.4) as ColorValue
  tokens["border-weaker-disabled"] = neutralAlpha[1]
  tokens["border-weaker-focus"] = neutralAlpha[5]

  tokens["border-interactive-base"] = interactive[6]
  tokens["border-interactive-hover"] = interactive[7]
  tokens["border-interactive-active"] = interactive[8]
  tokens["border-interactive-selected"] = interactive[8]
  tokens["border-interactive-disabled"] = neutral[7]
  tokens["border-interactive-focus"] = interactive[8]

  tokens["border-success-base"] = success[5]
  tokens["border-success-hover"] = success[6]
  tokens["border-success-selected"] = success[8]
  tokens["border-warning-base"] = warning[5]
  tokens["border-warning-hover"] = warning[6]
  tokens["border-warning-selected"] = warning[8]
  tokens["border-critical-base"] = error[isDark ? 4 : 5]
  tokens["border-critical-hover"] = error[6]
  tokens["border-critical-selected"] = error[8]
  tokens["border-info-base"] = info[5]
  tokens["border-info-hover"] = info[6]
  tokens["border-info-selected"] = info[8]
  tokens["border-color"] = "#ffffff"

  tokens["icon-base"] = neutral[8]
  tokens["icon-hover"] = neutral[isDark ? 9 : 10]
  tokens["icon-active"] = neutral[isDark ? 10 : 11]
  tokens["icon-selected"] = neutral[11]
  tokens["icon-disabled"] = neutral[isDark ? 6 : 7]
  tokens["icon-focus"] = neutral[11]
  tokens["icon-invert-base"] = isDark ? neutral[0] : "#ffffff"
  tokens["icon-weak-base"] = neutral[isDark ? 5 : 6]
  tokens["icon-weak-hover"] = neutral[6]
  tokens["icon-weak-active"] = neutral[7]
  tokens["icon-weak-selected"] = neutral[8]
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
  tokens["icon-success-base"] = success[isDark ? 6 : 6]
  tokens["icon-success-hover"] = success[7]
  tokens["icon-success-active"] = success[10]
  tokens["icon-warning-base"] = warning[6]
  tokens["icon-warning-hover"] = warning[7]
  tokens["icon-warning-active"] = warning[10]
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
  tokens["icon-agent-docs-base"] = warning[8]
  tokens["icon-agent-ask-base"] = interactive[8]
  tokens["icon-agent-build-base"] = interactive[isDark ? 10 : 8]

  tokens["icon-on-success-base"] = withAlpha(success[8], 0.9) as ColorValue
  tokens["icon-on-success-hover"] = withAlpha(success[9], 0.9) as ColorValue
  tokens["icon-on-success-selected"] = withAlpha(success[10], 0.9) as ColorValue
  tokens["icon-on-warning-base"] = withAlpha(warning[8], 0.9) as ColorValue
  tokens["icon-on-warning-hover"] = withAlpha(warning[9], 0.9) as ColorValue
  tokens["icon-on-warning-selected"] = withAlpha(warning[10], 0.9) as ColorValue
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
  tokens["icon-diff-modified-base"] = isDark ? "#ffba92" : "#FF8C00"

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
  tokens["syntax-warning"] = warning[9]
  tokens["syntax-critical"] = error[isDark ? 9 : 9]
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

  // ─── ACCENT TOKENS ───
  tokens["accent-base"] = accent[8]
  tokens["accent-hover"] = accent[9]
  tokens["accent-soft"] = accent[isDark ? 6 : 7]
  tokens["accent-muted"] = accent[isDark ? 4 : 5]
  tokens["accent-subtle"] = accent[isDark ? 2 : 3]
  tokens["accent-secondary-base"] = accentSecondary[8]
  tokens["accent-secondary-hover"] = accentSecondary[9]
  tokens["accent-secondary-soft"] = accentSecondary[isDark ? 6 : 7]
  tokens["accent-secondary-muted"] = accentSecondary[isDark ? 4 : 5]
  tokens["accent-tertiary-base"] = accentTertiary[8]
  tokens["accent-tertiary-hover"] = accentTertiary[9]
  tokens["accent-tertiary-soft"] = accentTertiary[isDark ? 6 : 7]

  // RGB components for glow generation
  const accentRgb = hexToRgb(accentSeed)
  const ar = Math.round(accentRgb.r * 255)
  const ag = Math.round(accentRgb.g * 255)
  const ab = Math.round(accentRgb.b * 255)
  const accent2Rgb = hexToRgb(accentSecondarySeed)
  const a2r = Math.round(accent2Rgb.r * 255)
  const a2g = Math.round(accent2Rgb.g * 255)
  const a2b = Math.round(accent2Rgb.b * 255)
  const accent3Rgb = hexToRgb(accentTertiarySeed)
  const a3r = Math.round(accent3Rgb.r * 255)
  const a3g = Math.round(accent3Rgb.g * 255)
  const a3b = Math.round(accent3Rgb.b * 255)
  const errRgb = hexToRgb(seeds.error)
  const er = Math.round(errRgb.r * 255)
  const eg_ = Math.round(errRgb.g * 255)
  const eb = Math.round(errRgb.b * 255)
  const sucRgb = hexToRgb(seeds.success)
  const sr = Math.round(sucRgb.r * 255)
  const sg = Math.round(sucRgb.g * 255)
  const sb = Math.round(sucRgb.b * 255)

  // ─── GLOW TOKENS ───
  if (isDark) {
    tokens["glow-accent"] = `0 0 24px -2px rgba(${ar}, ${ag}, ${ab}, 0.55), 0 0 6px rgba(${ar}, ${ag}, ${ab}, 0.3)`
    tokens["glow-accent-hover"] =
      `0 0 36px -2px rgba(${ar}, ${ag}, ${ab}, 0.7), 0 0 0 1px rgba(${ar}, ${ag}, ${ab}, 0.4)`
    tokens["glow-accent-focus"] =
      `0 0 40px -2px rgba(${ar}, ${ag}, ${ab}, 0.75), 0 0 0 3px rgba(${ar}, ${ag}, ${ab}, 0.4)`
    tokens["glow-secondary"] = `0 0 24px -2px rgba(${a2r}, ${a2g}, ${a2b}, 0.55)`
    tokens["glow-secondary-hover"] =
      `0 0 36px -2px rgba(${a2r}, ${a2g}, ${a2b}, 0.7), 0 0 0 1px rgba(${a2r}, ${a2g}, ${a2b}, 0.4)`
    tokens["glow-tertiary"] = `0 0 24px -2px rgba(${a3r}, ${a3g}, ${a3b}, 0.55)`
    tokens["glow-error"] = `0 0 20px -2px rgba(${er}, ${eg_}, ${eb}, 0.6)`
    tokens["glow-success"] = `0 0 24px -2px rgba(${sr}, ${sg}, ${sb}, 0.55)`
  } else {
    tokens["glow-accent"] = `0 0 16px -4px rgba(${ar}, ${ag}, ${ab}, 0.2), 0 2px 8px rgba(0, 0, 0, 0.06)`
    tokens["glow-accent-hover"] =
      `0 0 24px -4px rgba(${ar}, ${ag}, ${ab}, 0.3), 0 0 0 1px rgba(${ar}, ${ag}, ${ab}, 0.15), 0 2px 10px rgba(0, 0, 0, 0.08)`
    tokens["glow-accent-focus"] =
      `0 0 28px -4px rgba(${ar}, ${ag}, ${ab}, 0.35), 0 0 0 3px rgba(${ar}, ${ag}, ${ab}, 0.18), 0 2px 10px rgba(0, 0, 0, 0.08)`
    tokens["glow-secondary"] = `0 0 16px -4px rgba(${a2r}, ${a2g}, ${a2b}, 0.2), 0 2px 8px rgba(0, 0, 0, 0.06)`
    tokens["glow-secondary-hover"] =
      `0 0 24px -4px rgba(${a2r}, ${a2g}, ${a2b}, 0.3), 0 0 0 1px rgba(${a2r}, ${a2g}, ${a2b}, 0.15)`
    tokens["glow-tertiary"] = `0 0 16px -4px rgba(${a3r}, ${a3g}, ${a3b}, 0.2), 0 2px 8px rgba(0, 0, 0, 0.06)`
    tokens["glow-error"] = `0 0 14px -4px rgba(${er}, ${eg_}, ${eb}, 0.25), 0 2px 6px rgba(0, 0, 0, 0.06)`
    tokens["glow-success"] = `0 0 16px -4px rgba(${sr}, ${sg}, ${sb}, 0.2), 0 2px 8px rgba(0, 0, 0, 0.06)`
  }
  tokens["glow-none"] = "none"

  // ─── GLASS TOKENS ───
  if (isDark) {
    tokens["glass-base"] = `rgba(${ar > 100 ? 8 : 12}, ${ag > 100 ? 12 : 8}, 24, 0.92)`
    tokens["glass-strong"] = `rgba(${ar > 100 ? 4 : 8}, ${ag > 100 ? 6 : 4}, 18, 0.96)`
    tokens["glass-subtle"] = `rgba(${ar > 100 ? 12 : 16}, ${ag > 100 ? 18 : 12}, 36, 0.8)`
  } else {
    tokens["glass-base"] = "rgba(255, 255, 255, 0.88)"
    tokens["glass-strong"] = "rgba(245, 245, 250, 0.94)"
    tokens["glass-subtle"] = "rgba(255, 255, 255, 0.75)"
  }

  // ─── BORDER ACCENT TOKENS ───
  if (isDark) {
    tokens["border-accent-base"] = `rgba(${ar}, ${ag}, ${ab}, 0.22)`
    tokens["border-accent-hover"] = `rgba(${ar}, ${ag}, ${ab}, 0.4)`
    tokens["border-accent-focus"] = `rgba(${ar}, ${ag}, ${ab}, 0.6)`
    tokens["border-accent-secondary"] = `rgba(${a2r}, ${a2g}, ${a2b}, 0.3)`
  } else {
    tokens["border-accent-base"] = `rgba(${ar}, ${ag}, ${ab}, 0.1)`
    tokens["border-accent-hover"] = `rgba(${ar}, ${ag}, ${ab}, 0.22)`
    tokens["border-accent-focus"] = `rgba(${ar}, ${ag}, ${ab}, 0.4)`
    tokens["border-accent-secondary"] = `rgba(${a2r}, ${a2g}, ${a2b}, 0.12)`
  }

  // ─── MESSAGE TOKENS ───
  if (isDark) {
    tokens["message-user-tint"] = `rgba(${ar}, ${ag}, ${ab}, 0.12)`
    tokens["message-user-border"] = `rgba(${ar}, ${ag}, ${ab}, 0.7)`
    tokens["message-assistant-border"] = `rgba(${a2r}, ${a2g}, ${a2b}, 0.65)`
  } else {
    tokens["message-user-tint"] = `rgba(${ar}, ${ag}, ${ab}, 0.05)`
    tokens["message-user-border"] = `rgba(${ar}, ${ag}, ${ab}, 0.45)`
    tokens["message-assistant-border"] = `rgba(${a2r}, ${a2g}, ${a2b}, 0.35)`
  }

  // ─── CARD TOKENS ───
  if (isDark) {
    tokens["card-bg"] = `rgba(${ar}, ${ag}, ${ab}, 0.05)`
    tokens["card-bg-hover"] = `rgba(${ar}, ${ag}, ${ab}, 0.1)`
    tokens["card-glow"] = `0 0 28px -4px rgba(${ar}, ${ag}, ${ab}, 0.35), 0 0 8px rgba(${ar}, ${ag}, ${ab}, 0.15)`
  } else {
    tokens["card-bg"] = "rgba(0, 0, 0, 0.015)"
    tokens["card-bg-hover"] = `rgba(${ar}, ${ag}, ${ab}, 0.04)`
    tokens["card-glow"] = `0 0 20px -6px rgba(${ar}, ${ag}, ${ab}, 0.15), 0 2px 8px rgba(0, 0, 0, 0.05)`
  }

  // ─── CODE BLOCK TOKENS ───
  if (isDark) {
    tokens["code-bg"] = "rgba(2, 4, 16, 0.85)"
    tokens["code-border"] = `rgba(${ar}, ${ag}, ${ab}, 0.2)`
  } else {
    tokens["code-bg"] = "rgba(232, 232, 242, 0.55)"
    tokens["code-border"] = `rgba(${ar}, ${ag}, ${ab}, 0.12)`
  }

  // ─── SCROLLBAR TOKENS ───
  if (isDark) {
    tokens["scroll-accent"] = `rgba(${ar}, ${ag}, ${ab}, 0.3)`
    tokens["scroll-accent-hover"] = `rgba(${ar}, ${ag}, ${ab}, 0.5)`
  } else {
    tokens["scroll-accent"] = `rgba(${ar}, ${ag}, ${ab}, 0.14)`
    tokens["scroll-accent-hover"] = `rgba(${ar}, ${ag}, ${ab}, 0.25)`
  }

  // ─── SELECTION ───
  tokens["selection-accent"] = isDark ? `rgba(${ar}, ${ag}, ${ab}, 0.35)` : `rgba(${ar}, ${ag}, ${ab}, 0.18)`

  // ─── PROMPT / DOCK TOKENS ───
  if (isDark) {
    tokens["prompt-glow"] =
      `0 0 0 2px rgba(${ar}, ${ag}, ${ab}, 0.3), 0 0 60px -5px rgba(${ar}, ${ag}, ${ab}, 0.5), 0 20px 60px -10px rgba(0, 0, 0, 0.6)`
    tokens["prompt-btn-glow"] = `0 0 28px rgba(${ar}, ${ag}, ${ab}, 0.5), 0 0 8px rgba(${ar}, ${ag}, ${ab}, 0.3)`
    tokens["prompt-btn-glow-hover"] = `0 0 48px rgba(${ar}, ${ag}, ${ab}, 0.7), 0 0 12px rgba(${ar}, ${ag}, ${ab}, 0.4)`
  } else {
    tokens["prompt-glow"] =
      `0 0 0 4px rgba(${ar}, ${ag}, ${ab}, 0.1), 0 0 35px -10px rgba(${ar}, ${ag}, ${ab}, 0.2), 0 10px 30px -10px rgba(0, 0, 0, 0.1)`
    tokens["prompt-btn-glow"] = `0 0 20px rgba(${ar}, ${ag}, ${ab}, 0.22), 0 2px 8px rgba(0, 0, 0, 0.08)`
    tokens["prompt-btn-glow-hover"] = `0 0 30px rgba(${ar}, ${ag}, ${ab}, 0.35), 0 2px 10px rgba(0, 0, 0, 0.1)`
  }

  // ─── DIALOG TOKENS ───
  if (isDark) {
    tokens["dialog-shadow"] =
      `0 0 0 1px rgba(${ar}, ${ag}, ${ab}, 0.25), 0 0 100px -10px rgba(${ar}, ${ag}, ${ab}, 0.3), 0 30px 80px -20px rgba(0, 0, 0, 0.7)`
    tokens["popover-shadow"] =
      `0 0 0 1px rgba(${ar}, ${ag}, ${ab}, 0.25), 0 20px 60px -10px rgba(0, 0, 0, 0.6), 0 0 40px -10px rgba(${ar}, ${ag}, ${ab}, 0.2)`
  } else {
    tokens["dialog-shadow"] =
      `0 0 0 1px rgba(${ar}, ${ag}, ${ab}, 0.1), 0 0 50px -12px rgba(${ar}, ${ag}, ${ab}, 0.1), 0 30px 60px -20px rgba(0, 0, 0, 0.12)`
    tokens["popover-shadow"] = `0 0 0 1px rgba(${ar}, ${ag}, ${ab}, 0.1), 0 16px 40px -10px rgba(0, 0, 0, 0.12)`
  }

  // ─── PERMISSION WARNING TOKENS ───
  if (isDark) {
    tokens["permission-glow"] =
      `0 0 0 2px rgba(${a3r}, ${a3g}, ${a3b}, 0.5), 0 0 30px -4px rgba(${a3r}, ${a3g}, ${a3b}, 0.4)`
  } else {
    tokens["permission-glow"] =
      `0 0 0 1px rgba(${a3r}, ${a3g}, ${a3b}, 0.3), 0 0 20px -6px rgba(${a3r}, ${a3g}, ${a3b}, 0.18), 0 2px 8px rgba(0, 0, 0, 0.05)`
  }

  // ─── EMPTY STATE GRADIENT ───
  if (isDark) {
    tokens["empty-bg"] =
      `radial-gradient(ellipse 60% 40% at 50% 60%, rgba(${ar}, ${ag}, ${ab}, 0.15), rgba(${a2r}, ${a2g}, ${a2b}, 0.08) 50%, transparent)`
  } else {
    tokens["empty-bg"] =
      `radial-gradient(ellipse 60% 40% at 50% 60%, rgba(${ar}, ${ag}, ${ab}, 0.07), rgba(${a2r}, ${a2g}, ${a2b}, 0.035) 50%, transparent)`
  }

  // ─── THINKING / SPINNER ───
  tokens["thinking-color"] = accentSeed
  if (isDark) {
    tokens["thinking-glow"] = `0 0 14px rgba(${ar}, ${ag}, ${ab}, 0.6)`
  } else {
    tokens["thinking-glow"] = `0 0 8px rgba(${ar}, ${ag}, ${ab}, 0.45)`
  }

  // ─── PROGRESS GRADIENT ───
  tokens["progress-gradient"] = `linear-gradient(90deg, ${accentSeed}, ${accentSecondarySeed})`

  // ─── BLUR TOKENS (GPU-composited, only active for accent-aware themes) ───
  tokens["blur-card"] = "blur(12px)"
  tokens["blur-dialog"] = "blur(24px)"
  tokens["blur-overlay"] = "blur(8px)"
  tokens["blur-popover"] = "blur(20px)"
  tokens["blur-tooltip"] = "blur(12px)"
  tokens["blur-toast"] = "blur(16px)"
  tokens["blur-dock"] = "blur(24px)"
  tokens["blur-secondary-btn"] = "blur(8px)"
  tokens["blur-sidebar"] = "blur(20px)"
  tokens["blur-titlebar"] = "blur(20px)"

  // ─── RADIUS TOKENS ───
  tokens["radius-sm"] = "6px"
  tokens["radius-md"] = "10px"
  tokens["radius-lg"] = "14px"
  tokens["radius-xl"] = "18px"
  tokens["radius-2xl"] = "24px"
  tokens["radius-full"] = "9999px"

  // ─── MOTION / EASING TOKENS ───
  tokens["ease-smooth"] = "cubic-bezier(0.22, 1, 0.36, 1)"
  tokens["ease-spring"] = "cubic-bezier(0.34, 1.56, 0.64, 1)"
  tokens["ease-snappy"] = "cubic-bezier(0.16, 1, 0.3, 1)"
  tokens["duration-fast"] = "150ms"
  tokens["duration-normal"] = "250ms"
  tokens["duration-slow"] = "350ms"

  for (const [key, value] of Object.entries(overrides)) {
    tokens[key] = value
  }

  return tokens
}

function generateNeutralAlphaScale(neutralScale: HexColor[], isDark: boolean): HexColor[] {
  const alphas = isDark
    ? [0.02, 0.04, 0.08, 0.12, 0.16, 0.2, 0.26, 0.36, 0.44, 0.52, 0.72, 0.94]
    : [0.01, 0.03, 0.06, 0.09, 0.12, 0.15, 0.2, 0.27, 0.46, 0.61, 0.5, 0.87]

  return neutralScale.map((hex, i) => {
    const baseOklch = hexToOklch(hex)
    const targetL = isDark ? 0.1 + alphas[i] * 0.8 : 1 - alphas[i] * 0.8
    return oklchToHex({
      ...baseOklch,
      l: baseOklch.l * alphas[i] + targetL * (1 - alphas[i]),
    })
  })
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

import type { ColorValue, DesktopTheme, HexColor, ResolvedTheme, ThemeVariant } from "./types"
import { generateNeutralScale, generateScale, hexToOklch, oklchToHex, withAlpha } from "./color"

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
  tokens["text-invert-base"] = isDark ? neutral[10] : neutralAlpha[10]
  tokens["text-invert-weak"] = isDark ? neutral[8] : neutralAlpha[8]
  tokens["text-invert-weaker"] = isDark ? neutral[7] : neutralAlpha[7]
  tokens["text-invert-strong"] = isDark ? neutral[11] : neutralAlpha[11]
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

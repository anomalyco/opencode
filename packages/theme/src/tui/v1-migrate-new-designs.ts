import { RGBA } from "@opentui/core"
import { oklchToHex } from "./color.js"
import type { HueDefinition, Mode, ModeDefinition, ThemeDefinition, ThemeDocument } from "./index.js"
import { HueStep } from "./schema.js"
import type { Theme, ThemeV1Json } from "./v1.js"
import {
  base,
  byte,
  categoricalTokens,
  chromaticHues,
  detectMode,
  dialogBackground,
  hex,
  inferHues,
  referenceHues,
  resolveV1,
  selectedForeground,
  toOklch,
  type ThemeColor,
} from "./v1-migrate.js"

// Temporary V1 migration for the "new-designs" experiment. It lays V1 colors out on the opencode2 steps and
// replaces migrateV1 once the experiment ships.
export function migrateV1NewDesigns(theme: ThemeV1Json): ThemeDocument {
  const light = resolveV1(theme, "light")
  const dark = resolveV1(theme, "dark")
  if (light.background.a > 0 && dark.background.a > 0 && light.background.equals(dark.background)) {
    const lightMode = detectMode(light)
    const darkMode = detectMode(dark)
    if (lightMode === darkMode) {
      const definition = migrateMode(lightMode === "light" ? light : dark, lightMode)
      if (lightMode === "light") return { base: base(definition), light: lightOverrides(definition, light) }
      return { base: base(definition), dark: { hue: definition.hue } }
    }
  }
  const lightDefinition = migrateMode(light, "light")
  const darkDefinition = migrateMode(dark, "dark")
  return {
    base: base(lightDefinition),
    light: lightOverrides(lightDefinition, light),
    dark: darkDefinition,
  }
}

// Light dialogs sit a step below the page like opencode2's, so rows can hover above them.
const lightDialog = {
  background: {
    base: "$hue.neutral.800",
    raised: { high: "$hue.neutral.700" },
    action: {
      primary: { $hovered: "$hue.neutral.600" },
      secondary: { $hovered: "$hue.neutral.600" },
    },
  },
} satisfies ModeDefinition["@dialog"]

function lightOverrides(definition: ThemeDefinition, theme: Theme): ModeDefinition {
  if (theme.backgroundPanel.a === 1) return { hue: definition.hue, "@dialog": lightDialog }
  return {
    hue: definition.hue,
    "@dialog": { ...lightDialog, background: { ...lightDialog.background, base: dialogBackground(theme) } },
  }
}

// Mirrors the opencode2 token layout: text at 100/200/300, the page at 900, raised surfaces at 700/600/500,
// and each V1 color anchored at 400 with quieter steps around it.
function migrateMode(theme: Theme, mode: Mode): ThemeDefinition {
  const color = (key: ThemeColor) => hex(theme[key])
  const neutral = neutralScale(theme, mode)
  const primary = "$hue.interactive.400"

  return referenceHues({
    ...paletteHues(theme, neutral.scale, (color) => hueScale(color, mode, neutral)),
    text: {
      base: "$hue.neutral.100",
      muted: "$hue.neutral.200",
      faint: "$hue.neutral.300",
      action: {
        primary: {
          base: "$text.base",
          $disabled: "$text.faint",
          $focused: "$text.base",
          $selected: primary,
        },
        secondary: { base: "$text.muted", $hovered: "$text.base", $focused: "$hue.interactive.200" },
        destructive: { base: hex(selectedForeground(theme, theme.error)), $disabled: "$text.faint" },
      },
      formfield: {
        base: "$text.base",
        $hovered: primary,
        $focused: primary,
        $pressed: primary,
        $disabled: "$text.faint",
        $selected: primary,
      },
      feedback: {
        error: { base: color("error") },
        warning: { base: color("warning") },
        success: { base: color("success") },
        info: { base: color("info") },
      },
    },
    background: {
      base: "$hue.neutral.900",
      raised: {
        base: "$hue.neutral.700",
        high: "$hue.neutral.600",
        max: "$hue.neutral.500",
      },
      action: {
        primary: {
          base: "transparent",
          $hovered: "$hue.neutral.700",
          $focused: "$hue.interactive.600",
          $selected: "transparent",
        },
        secondary: { base: "transparent" },
        destructive: { base: color("error") },
      },
      formfield: {
        base: "$background.base",
      },
      feedback: {
        error: { base: "$background.base" },
        warning: { base: "$background.base" },
        success: { base: "$background.base" },
        info: { base: "$background.base" },
      },
    },
    ...paletteTokens(theme),
    "@dialog": {
      background: {
        base: dialogBackground(theme),
        action: {
          primary: { $hovered: "$background.raised.max" },
          secondary: { $hovered: "$background.raised.max" },
        },
      },
    },
  })
}

// Step profiles measured from the opencode2 theme. Only lightness and chroma are taken from it; hues and
// anchors always come from the V1 theme being migrated.
const profiles = {
  dark: {
    // Lightness of each surface step above the page background.
    surface: { 900: 0, 800: 0.039, 700: 0.057, 600: 0.11, 500: 0.175, 400: 0.253 },
    // Where muted and faint text sit between the page (0) and the text color (1).
    text: { 200: 0.719, 300: 0.538 },
    // Lightness of each chromatic step relative to the neutral step of the same number.
    hueLightness: { 100: -0.035, 200: -0.023, 300: -0.003, 600: 0.095, 700: 0.071, 800: 0.024, 900: 0.012 },
    // Chroma of each chromatic step as a share of the anchor's chroma.
    hueChroma: { 100: 0.1, 200: 0.24, 300: 0.22, 500: 0.64, 600: 0.2, 700: 0.14, 800: 0.09, 900: 0.07 },
    // Step 500 sits this far from the anchor toward step 600.
    hueMid: 0.55,
    // Least share of the text-on-page contrast that text keeps on each background step.
    readable: { 800: 0.95, 700: 0.92, 600: 0.81, 500: 0.66, 900: 0.99 },
    readableHue: { 600: 0.7, 700: 0.82, 800: 0.92, 900: 0.99 },
  },
  light: {
    surface: { 900: 0, 800: -0.015, 700: -0.039, 600: -0.102, 500: -0.145, 400: -0.227 },
    text: { 200: 0.688, 300: 0.484 },
    hueLightness: { 100: 0.083, 200: 0.13, 300: 0.116, 600: 0.021, 700: -0.002, 800: -0.004, 900: -0.008 },
    hueChroma: { 100: 0.19, 200: 0.12, 300: 0.16, 500: 0.38, 600: 0.17, 700: 0.1, 800: 0.05, 900: 0.02 },
    hueMid: 0.65,
    readable: { 800: 0.96, 700: 0.89, 600: 0.74, 500: 0.64, 900: 0.97 },
    readableHue: { 600: 0.78, 700: 0.88, 800: 0.93, 900: 0.97 },
  },
} satisfies Record<
  Mode,
  {
    surface: Record<900 | 800 | 700 | 600 | 500 | 400, number>
    text: Record<200 | 300, number>
    hueLightness: Record<Exclude<HueStep, 400 | 500>, number>
    hueChroma: Record<Exclude<HueStep, 400>, number>
    hueMid: number
    readable: Record<900 | 800 | 700 | 600 | 500, number>
    readableHue: Record<900 | 800 | 700 | 600, number>
  }
>

// Body text on surfaces and selections should stay comfortable to read even in low-contrast themes.
const minimumSurfaceContrast = 4.5
const maximumDimming = 0.6

function neutralScale(theme: Theme, mode: Mode) {
  const profile = profiles[mode]
  const opaque = (color: RGBA) => color.toInts()[3] > 0
  const element = [theme.backgroundElement, theme.backgroundMenu].find(opaque)
  const sources = [
    { step: 900, color: theme.background },
    { step: 700, color: theme.backgroundPanel },
    { step: 600, color: element },
  ] as const
  const reference = sources.find((source) => source.color && opaque(source.color))
  const page = reference
    ? toOklch(reference.color!)
    : toOklch(mode === "dark" ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255))
  const pageLightness = page.l - (reference ? profile.surface[reference.step] : 0)
  const tint = (...colors: (RGBA | undefined)[]) => {
    const color = colors.find((color) => color && opaque(color))
    return color ? toOklch(color) : page
  }
  const surfaceTint = {
    900: tint(theme.background, theme.backgroundPanel, element),
    800: tint(theme.backgroundPanel, theme.background, element),
    700: tint(theme.backgroundPanel, theme.background, element),
    600: tint(element, theme.backgroundPanel, theme.background),
    500: tint(element, theme.backgroundPanel, theme.background),
    400: tint(element, theme.backgroundPanel, theme.background),
  }
  const lightness = {} as Record<HueStep, number>
  // Lightness before readability dimming, so chromatic steps keep their place relative to the profile.
  const planned = {} as Record<HueStep, number>
  const scale = {} as Record<HueStep, string>
  const text = toOklch(theme.text)
  const pageColor = { ...surfaceTint[900], l: pageLightness }
  const pageContrast = contrast(theme.text, RGBA.fromHex(oklchToHex(pageColor)))
  // Pulls a generated background back toward the page until text on it keeps enough contrast.
  const readable = (color: OklchColor, share: number) => {
    const target = Math.max(pageContrast * share, Math.min(minimumSurfaceContrast, pageContrast * 0.95))
    const passes = (amount: number) =>
      contrast(theme.text, RGBA.fromHex(oklchToHex(mix(color, pageColor, amount)))) >= target
    if (passes(0)) return color
    // Stop short of the page so surfaces and selections stay visible in low-contrast themes.
    if (!passes(maximumDimming)) return mix(color, pageColor, maximumDimming)
    let [low, high] = [0, maximumDimming]
    for (let index = 0; index < 12; index++) {
      const amount = (low + high) / 2
      if (passes(amount)) high = amount
      else low = amount
    }
    return mix(color, pageColor, high)
  }
  for (const step of [800, 700, 600, 500, 400] as const) {
    const generated = { ...surfaceTint[step], l: pageLightness + profile.surface[step] }
    const color = step === 400 ? generated : readable(generated, profile.readable[step])
    planned[step] = generated.l
    lightness[step] = color.l
    scale[step] = oklchToHex(color)
  }
  lightness[900] = pageLightness
  scale[900] = hex(theme.background)
  // Transparent V1 surfaces stay transparent so the terminal shows through, as they did before.
  for (const [step, color] of [
    [800, theme.backgroundPanel],
    [700, theme.backgroundPanel],
    [600, theme.backgroundElement],
  ] as const) {
    if (!opaque(color)) scale[step] = hex(color)
  }
  lightness[100] = text.l
  scale[100] = hex(theme.text)
  for (const step of [200, 300] as const) {
    const generated = mix(pageColor, text, profile.text[step])
    lightness[step] = generated.l
    scale[step] = oklchToHex(generated)
  }
  // Keep the theme's own muted text on whichever text step it is closest to.
  const muted = toOklch(theme.textMuted)
  const mutedStep = Math.abs(muted.l - lightness[200]) <= Math.abs(muted.l - lightness[300]) ? 200 : 300
  lightness[mutedStep] = muted.l
  scale[mutedStep] = hex(theme.textMuted)
  return { scale, lightness: { ...lightness, ...planned }, readable }
}

function hueScale(color: RGBA, mode: Mode, neutral: ReturnType<typeof neutralScale>) {
  const profile = profiles[mode]
  const anchor = toOklch(color)
  const alpha = color.toInts()[3]
  const generate = (generated: OklchColor) => {
    const value = oklchToHex(generated)
    return alpha === 255 ? value : `${value}${byte(alpha)}`
  }
  const lightness = (step: Exclude<HueStep, 400 | 500>) => neutral.lightness[step] + profile.hueLightness[step]
  return Object.fromEntries(
    HueStep.literals.map((step) => {
      if (step === 400) return [step, hex(color)]
      const generated = {
        l: step === 500 ? anchor.l + (lightness(600) - anchor.l) * profile.hueMid : lightness(step),
        c: anchor.c * profile.hueChroma[step],
        h: anchor.h,
      }
      if (step === 600 || step === 700 || step === 800 || step === 900)
        return [step, generate(neutral.readable(generated, profile.readableHue[step]))]
      return [step, generate(generated)]
    }),
  ) as Record<HueStep, string>
}

type OklchColor = ReturnType<typeof toOklch>

function contrast(first: RGBA, second: RGBA) {
  const luminance = (color: RGBA) => {
    const channel = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
  }
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (lighter! + 0.05) / (darker! + 0.05)
}

function mix(start: OklchColor, end: OklchColor, amount: number) {
  const startHue = start.c > 0.002 ? start.h : end.h
  const endHue = end.c > 0.002 ? end.h : startHue
  const hue = ((((endHue - startHue) % 360) + 540) % 360) - 180
  return {
    l: start.l + (end.l - start.l) * amount,
    c: start.c + (end.c - start.c) * amount,
    h: startHue + hue * amount,
  }
}

function paletteHues(theme: Theme, gray: Record<HueStep, string>, scale: (color: RGBA) => Record<HueStep, string>) {
  const hues = inferHues(theme)
  const categorical = categoricalTokens.flatMap((token) => {
    const hue = hues.byToken[token]
    return hue ? [hue] : []
  })
  const uniqueCategorical = categorical.filter((hue, index) => categorical.indexOf(hue) === index)
  return {
    hue: {
      gray,
      ...Object.fromEntries(
        chromaticHues.flatMap((name) => {
          const match = hues.byHue[name]
          return match ? [[name, scale(match.color)]] : []
        }),
      ),
      accent: hues.byToken.accent ? `$hue.${hues.byToken.accent}` : "$hue.gray",
      interactive: hues.byToken.primary ? `$hue.${hues.byToken.primary}` : "$hue.gray",
      neutral: "$hue.gray",
    } as HueDefinition,
    categorical: uniqueCategorical.length ? uniqueCategorical : ["neutral"],
  } satisfies Partial<ThemeDefinition>
}

function paletteTokens(theme: Theme) {
  const color = (key: ThemeColor) => hex(theme[key])
  return {
    border: { base: color("border") },
    scrollbar: { base: color("borderActive") },
    diff: {
      text: {
        added: color("diffAdded"),
        removed: color("diffRemoved"),
        context: color("diffContext"),
        hunkHeader: color("diffHunkHeader"),
      },
      background: {
        added: color("diffAddedBg"),
        removed: color("diffRemovedBg"),
        context: color("diffContextBg"),
      },
      highlight: { added: color("diffHighlightAdded"), removed: color("diffHighlightRemoved") },
      lineNumber: {
        text: color("diffLineNumber"),
        background: {
          added: color("diffAddedLineNumberBg"),
          removed: color("diffRemovedLineNumberBg"),
        },
      },
    },
    syntax: {
      comment: color("syntaxComment"),
      keyword: color("syntaxKeyword"),
      function: color("syntaxFunction"),
      variable: color("syntaxVariable"),
      string: color("syntaxString"),
      number: color("syntaxNumber"),
      type: color("syntaxType"),
      operator: color("syntaxOperator"),
      punctuation: color("syntaxPunctuation"),
    },
    markdown: {
      text: color("markdownText"),
      heading: color("markdownHeading"),
      link: color("markdownLink"),
      linkText: color("markdownLinkText"),
      code: color("markdownCode"),
      blockQuote: color("markdownBlockQuote"),
      emphasis: color("markdownEmph"),
      strong: color("markdownStrong"),
      horizontalRule: color("markdownHorizontalRule"),
      listItem: color("markdownListItem"),
      listEnumeration: color("markdownListEnumeration"),
      image: color("markdownImage"),
      imageText: color("markdownImageText"),
      codeBlock: color("markdownCodeBlock"),
    },
  } satisfies Partial<ThemeDefinition>
}

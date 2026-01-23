import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

// Get root directory - script is in script/ folder
const rootDir = process.cwd()

type HexColor = `#${string}`
type RefName = string
type Variant = {
  dark: HexColor | RefName
  light: HexColor | RefName
}
type ColorValue = HexColor | RefName | Variant

type TuiThemeJson = {
  $schema?: string
  defs?: Record<string, HexColor | RefName>
  theme: Record<string, ColorValue>
}

type DesktopTheme = {
  $schema: string
  name: string
  id: string
  light: {
    seeds: {
      neutral: HexColor
      primary: HexColor
      success: HexColor
      warning: HexColor
      error: HexColor
      info: HexColor
      interactive: HexColor
      diffAdd: HexColor
      diffDelete: HexColor
    }
    overrides: Record<string, HexColor>
  }
  dark: {
    seeds: {
      neutral: HexColor
      primary: HexColor
      success: HexColor
      warning: HexColor
      error: HexColor
      info: HexColor
      interactive: HexColor
      diffAdd: HexColor
      diffDelete: HexColor
    }
    overrides: Record<string, HexColor>
  }
}

function resolveColor(
  c: ColorValue,
  defs: Record<string, HexColor | RefName>,
  theme: Record<string, ColorValue>,
  mode: "dark" | "light",
): HexColor {
  if (typeof c === "string") {
    if (c === "transparent" || c === "none") {
      return mode === "dark" ? "#000000" : "#ffffff"
    }
    if (c.startsWith("#")) {
      return c as HexColor
    }
    // Reference to defs
    if (defs[c] != null) {
      const defValue = defs[c]
      if (typeof defValue === "string" && defValue.startsWith("#")) {
        return defValue as HexColor
      }
      if (typeof defValue === "string") {
        return resolveColor(defValue, defs, theme, mode)
      }
    }
    // Reference to theme property
    if (theme[c] !== undefined) {
      return resolveColor(theme[c], defs, theme, mode)
    }
    throw new Error(`Color reference "${c}" not found`)
  }
  // Variant object
  return resolveColor(c[mode], defs, theme, mode)
}

function convertTuiThemeToDesktop(
  tuiTheme: TuiThemeJson,
  themeId: string,
  themeName: string,
): DesktopTheme {
  const defs = tuiTheme.defs ?? {}

  // Resolve colors for both modes
  const resolveForMode = (mode: "dark" | "light") => {
    const resolved: Record<string, HexColor> = {}
    for (const [key, value] of Object.entries(tuiTheme.theme)) {
      if (key === "selectedListItemText" || key === "backgroundMenu" || key === "thinkingOpacity") {
        continue
      }
      try {
        resolved[key] = resolveColor(value, defs, tuiTheme.theme, mode)
      } catch (e) {
        console.warn(`Failed to resolve ${key} for ${mode}: ${e}`)
        resolved[key] = mode === "dark" ? "#ffffff" : "#000000"
      }
    }
    return resolved
  }

  const darkColors = resolveForMode("dark")
  const lightColors = resolveForMode("light")

  const darkSeeds = {
    neutral: darkColors.background || "#1a1a1a",
    primary: darkColors.primary || "#007acc",
    success: darkColors.success || "#4ec9b0",
    warning: darkColors.warning || "#dcdcaa",
    error: darkColors.error || "#f48771",
    info: darkColors.info || "#4ec9b0",
    interactive: darkColors.primary || "#007acc",
    diffAdd: darkColors.diffAdded || "#4ec9b0",
    diffDelete: darkColors.diffRemoved || "#f48771",
  }

  const lightSeeds = {
    neutral: lightColors.background || "#ffffff",
    primary: lightColors.primary || "#0066cc",
    success: lightColors.success || "#4caf50",
    warning: lightColors.warning || "#ff9800",
    error: lightColors.error || "#e91e63",
    info: lightColors.info || "#00acc1",
    interactive: lightColors.primary || "#0066cc",
    diffAdd: lightColors.diffAdded || "#4caf50",
    diffDelete: lightColors.diffRemoved || "#e91e63",
  }

  // Map syntax and markdown colors to overrides
  const mapOverrides = (colors: Record<string, HexColor>, mode: "dark" | "light") => {
    const overrides: Record<string, HexColor> = {}

    // Background colors
    if (colors.background) overrides["background-base"] = colors.background
    if (colors.backgroundPanel) overrides["background-weak"] = colors.backgroundPanel
    if (colors.backgroundElement) overrides["background-strong"] = colors.backgroundElement

    // Text colors
    if (colors.text) overrides["text-base"] = colors.text
    if (colors.textMuted) overrides["text-weak"] = colors.textMuted

    // Border colors
    if (colors.border) overrides["border-base"] = colors.border
    if (colors.borderActive) overrides["border-strong-base"] = colors.borderActive

    // Syntax colors
    if (colors.syntaxString) overrides["syntax-string"] = colors.syntaxString
    if (colors.syntaxNumber) overrides["syntax-primitive"] = colors.syntaxNumber
    if (colors.syntaxFunction) overrides["syntax-property"] = colors.syntaxFunction
    if (colors.syntaxType) overrides["syntax-type"] = colors.syntaxType
    if (colors.syntaxComment) overrides["syntax-constant"] = colors.syntaxComment
    if (colors.syntaxComment) overrides["syntax-info"] = colors.syntaxComment

    // Markdown colors
    if (colors.markdownHeading) overrides["markdown-heading"] = colors.markdownHeading
    if (colors.markdownText) overrides["markdown-text"] = colors.markdownText
    if (colors.markdownLink) overrides["markdown-link"] = colors.markdownLink
    if (colors.markdownLinkText) overrides["markdown-link-text"] = colors.markdownLinkText
    if (colors.markdownCode) overrides["markdown-code"] = colors.markdownCode
    if (colors.markdownBlockQuote) overrides["markdown-block-quote"] = colors.markdownBlockQuote
    if (colors.markdownEmph) overrides["markdown-emph"] = colors.markdownEmph
    if (colors.markdownStrong) overrides["markdown-strong"] = colors.markdownStrong
    if (colors.markdownHorizontalRule) overrides["markdown-horizontal-rule"] = colors.markdownHorizontalRule
    if (colors.markdownListItem) overrides["markdown-list-item"] = colors.markdownListItem
    if (colors.markdownListEnumeration) overrides["markdown-list-enumeration"] = colors.markdownListEnumeration
    if (colors.markdownImage) overrides["markdown-image"] = colors.markdownImage
    if (colors.markdownImageText) overrides["markdown-image-text"] = colors.markdownImageText
    if (colors.markdownCodeBlock) overrides["markdown-code-block"] = colors.markdownCodeBlock

    // Diff colors
    if (colors.diffAddedBg) overrides["surface-diff-add-base"] = colors.diffAddedBg
    if (colors.diffRemovedBg) overrides["surface-diff-delete-base"] = colors.diffRemovedBg

    return overrides
  }

  return {
    $schema: "https://opencode.ai/desktop-theme.json",
    name: themeName,
    id: themeId,
    light: {
      seeds: lightSeeds,
      overrides: mapOverrides(lightColors, "light"),
    },
    dark: {
      seeds: darkSeeds,
      overrides: mapOverrides(darkColors, "dark"),
    },
  }
}

function toTitleCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function main() {
  const tuiThemeDir = join(rootDir, "packages/opencode/src/cli/cmd/tui/context/theme")
  const desktopThemeDir = join(rootDir, "packages/ui/src/theme/themes")

  // Themes that already exist in desktop (skip these)
  const existingThemes = new Set([
    "aura",
    "ayu",
    "carbonfox",
    "catppuccin",
    "dracula",
    "gruvbox",
    "monokai",
    "nightowl",
    "nord",
    "solarized",
    "tokyonight",
    "vesper",
    "onedarkpro", // Note: TUI has "one-dark" but desktop has "onedarkpro"
  ])

  // Themes to convert (all TUI themes minus existing ones)
  const themesToConvert = [
    "cobalt2",
    "cursor",
    "everforest",
    "flexoki",
    "github",
    "kanagawa",
    "lucent-orng",
    "material",
    "matrix",
    "mercury",
    "one-dark",
    "orng",
    "osaka-jade",
    "palenight",
    "rosepine",
    "synthwave84",
    "vercel",
    "zenburn",
    "catppuccin-frappe",
    "catppuccin-macchiato",
  ]

  console.log(`Converting ${themesToConvert.length} themes...`)

  for (const themeFile of themesToConvert) {
    try {
      const tuiThemePath = join(tuiThemeDir, `${themeFile}.json`)
      const tuiThemeContent = readFileSync(tuiThemePath, "utf-8")
      const tuiTheme: TuiThemeJson = JSON.parse(tuiThemeContent)

      // Generate theme name and ID
      const themeId = themeFile === "one-dark" ? "one-dark" : themeFile
      const themeName = toTitleCase(themeFile.replace(/-/g, " "))

      const desktopTheme = convertTuiThemeToDesktop(tuiTheme, themeId, themeName)

      const desktopThemePath = join(desktopThemeDir, `${themeId}.json`)
      writeFileSync(desktopThemePath, JSON.stringify(desktopTheme, null, 2) + "\n", "utf-8")

      console.log(`✓ Converted ${themeFile} -> ${themeId}.json`)
    } catch (error) {
      console.error(`✗ Failed to convert ${themeFile}:`, error)
    }
  }

  console.log("\nConversion complete!")
}

main()

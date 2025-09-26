import type { Plugin } from "vite"
import { readdir, readFile, writeFile } from "fs/promises"
import { join, resolve } from "path"

interface ThemeDefinition {
  $schema?: string
  defs?: Record<string, string>
  theme: Record<string, any>
}

interface ResolvedThemeColor {
  dark: string
  light: string
}

class ColorResolver {
  private colors: Map<string, any> = new Map()
  private visited: Set<string> = new Set()

  constructor(defs: Record<string, string> = {}, theme: Record<string, any> = {}) {
    Object.entries(defs).forEach(([key, value]) => {
      this.colors.set(key, value)
    })
    Object.entries(theme).forEach(([key, value]) => {
      this.colors.set(key, value)
    })
  }

  resolveColor(key: string, value: any): ResolvedThemeColor {
    if (this.visited.has(key)) {
      throw new Error(`Circular reference detected for color ${key}`)
    }

    this.visited.add(key)

    try {
      if (typeof value === "string") {
        if (value === "none") return { dark: value, light: value }
        if (value.startsWith("#")) {
          return { dark: value.toLowerCase(), light: value.toLowerCase() }
        }
        const resolved = this.resolveReference(value)
        return { dark: resolved, light: resolved }
      }
      if (typeof value === "object" && value !== null) {
        const dark = this.resolveColorValue(value.dark || value.light || "#000000")
        const light = this.resolveColorValue(value.light || value.dark || "#FFFFFF")
        return { dark, light }
      }
      return { dark: "#000000", light: "#FFFFFF" }
    } finally {
      this.visited.delete(key)
    }
  }

  private resolveColorValue(value: any): string {
    if (typeof value === "string") {
      if (value === "none") return value
      if (value.startsWith("#")) {
        return value.toLowerCase()
      }
      return this.resolveReference(value)
    }
    return value
  }

  private resolveReference(ref: string): string {
    const colorValue = this.colors.get(ref)
    if (colorValue === undefined) {
      throw new Error(`Color reference '${ref}' not found`)
    }
    if (typeof colorValue === "string") {
      if (colorValue === "none") return colorValue
      if (colorValue.startsWith("#")) {
        return colorValue.toLowerCase()
      }
      return this.resolveReference(colorValue)
    }
    return colorValue
  }
}

function kebabCase(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()
}

function parseTheme(themeData: ThemeDefinition): Record<string, ResolvedThemeColor> {
  const resolver = new ColorResolver(themeData.defs, themeData.theme)
  const colors: Record<string, ResolvedThemeColor> = {}
  Object.entries(themeData.theme).forEach(([key, value]) => {
    colors[key] = resolver.resolveColor(key, value)
  })
  return colors
}

async function loadThemes(): Promise<Record<string, Record<string, ResolvedThemeColor>>> {
  const themesDir = resolve(__dirname, "../../tui/internal/theme/themes")
  const files = await readdir(themesDir)
  const themes: Record<string, Record<string, ResolvedThemeColor>> = {}

  for (const file of files) {
    if (!file.endsWith(".json")) continue

    const themeName = file.replace(".json", "")
    const themeData: ThemeDefinition = JSON.parse(await readFile(join(themesDir, file), "utf-8"))

    themes[themeName] = parseTheme(themeData)
  }

  return themes
}

function generateCSS(themes: Record<string, Record<string, ResolvedThemeColor>>): string {
  let css = `/* Auto-generated theme CSS - Do not edit manually */\n:root {\n`

  const defaultTheme = themes["opencode"] || Object.values(themes)[0]
  if (defaultTheme) {
    Object.entries(defaultTheme).forEach(([key, color]) => {
      const cssVar = `--theme-${kebabCase(key)}`
      css += `  ${cssVar}: ${color.light};\n`
    })
  }
  css += `}\n\n`

  Object.entries(themes).forEach(([themeName, colors]) => {
    css += `[data-theme="${themeName}"][data-dark="false"] {\n`
    Object.entries(colors).forEach(([key, color]) => {
      const cssVar = `--theme-${kebabCase(key)}`
      css += `  ${cssVar}: ${color.light};\n`
    })
    css += `}\n\n`

    css += `[data-theme="${themeName}"][data-dark="true"] {\n`
    Object.entries(colors).forEach(([key, color]) => {
      const cssVar = `--theme-${kebabCase(key)}`
      css += `  ${cssVar}: ${color.dark};\n`
    })
    css += `}\n\n`
  })

  return css
}

export function generateThemeCSS(): Plugin {
  return {
    name: "generate-theme-css",
    async buildStart() {
      try {
        console.log("Generating theme CSS...")
        const themes = await loadThemes()
        const css = generateCSS(themes)

        const outputPath = resolve(__dirname, "../src/assets/theme.css")
        await writeFile(outputPath, css)

        console.log(`✅ Generated theme CSS with ${Object.keys(themes).length} themes`)
        console.log(`   Output: ${outputPath}`)
      } catch (error) {
        throw new Error(`Theme CSS generation failed: ${error}`)
      }
    },
  }
}

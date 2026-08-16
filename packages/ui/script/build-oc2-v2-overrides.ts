#!/usr/bin/env bun

import { V2_PRIMITIVES_DEFAULT } from "../src/theme/v2/default-primitives"
import type { DesktopTheme } from "../src/theme/types"

const themePath = import.meta.dir + "/../src/theme/themes/oc-2.json"
const theme = (await Bun.file(themePath).json()) as DesktopTheme
const css = await Bun.file(import.meta.dir + "/../src/v2/styles/theme.css").text()

const light = { ...V2_PRIMITIVES_DEFAULT, ...readTokens("light") }
const dark = { ...V2_PRIMITIVES_DEFAULT, ...readTokens("dark") }

const next: DesktopTheme = {
  ...theme,
  light: { ...theme.light, v2Overrides: light },
  dark: { ...theme.dark, v2Overrides: dark },
}

await Bun.write(themePath, JSON.stringify(next, null, 2) + "\n")
console.log("Updated oc-2.json v2Overrides", Object.keys(light).length, "tokens per mode")

function readTokens(mode: "light" | "dark") {
  const selector = mode === "light" ? ":root" : `\\[data-color-scheme="${mode}"\\]`
  const block = css.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n  \\}`))?.[1]
  if (!block) throw new Error(`Missing ${mode} OC-2 tokens`)
  return Object.fromEntries(
    [...block.matchAll(/--(v2-[\w-]+):\s*([^;]+);/g)]
      // Fonts and the fixed avatar foreground remain global CSS rather than theme overrides.
      .filter(([, key]) => key !== "v2-avatar-fg" && key !== "v2-font-family-sans")
      .map(([, key, value]) => [key, value!.replace(/\s+/g, " ").trim()]),
  )
}

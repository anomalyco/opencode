import { writeFileSync } from "fs"
import jitdaJson from "../src/theme/themes/jitda.json"
import { resolveThemeVariant, themeToCss } from "../src/theme/resolve"
import type { DesktopTheme } from "../src/theme/types"

const jitda = jitdaJson as DesktopTheme

const header = `/*
 * Jitda 테마 정적 fallback.
 * 팔레트 원본은 packages/ui/src/theme/themes/jitda.json 이다.
 */
`

const light = resolveThemeVariant(jitda.light, false)
const dark = resolveThemeVariant(jitda.dark, true)
const indent = (css: string) => css.trim().split("\n").map((line) => `  ${line}`).join("\n")

const out =
  header +
  `:root {\n${indent(themeToCss(light))}\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n${indent(themeToCss(dark))}\n  }\n}\n`

writeFileSync(new URL("../src/styles/theme.jitda.css", import.meta.url), out)
console.log("wrote theme.jitda.css")

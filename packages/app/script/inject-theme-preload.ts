/**
 * Injects the theme preload script into index.html.
 * Run this as part of the build process.
 */

import { generatePreloadScript } from "@opencode-ai/ui/theme"

const htmlPath = new URL("../index.html", import.meta.url).pathname
const html = await Bun.file(htmlPath).text()

const script = generatePreloadScript()
const injectedHtml = html.replace(
  /<script id="oc-theme-preload-script">\s*\/\* THEME_PRELOAD_SCRIPT \*\/\s*<\/script>/,
  `<script id="oc-theme-preload-script">${script}</script>`,
)

await Bun.write(htmlPath, injectedHtml)
console.log("Injected theme preload script into index.html")

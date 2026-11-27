import { expect, test } from "bun:test"
import { inlineThemePreload } from "../vite.js"

// The production HTML carries the theme preload inline, so the first paint already has the user's color scheme.
test.each(["/oc-theme-preload.js", "./oc-theme-preload.js"])("inlines %s before the renderer runs", (path) => {
  const html = inlineThemePreload(`<script id="oc-theme-preload-script" src="${path}"></script>`)
  expect(html).not.toContain(" src=")
  expect(html).toContain("opencode-color-scheme")
})

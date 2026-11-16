import { expect, test } from "bun:test"
import path from "node:path"
import { preprocessCSS, resolveConfig } from "vite"
import { cssVariants } from "~/component/site/css-variants"
import variants from "~/component/site/css-variants.json"
import { cssVariantsForProduction } from "../script/css-variants-plugin"

// The production build drops CSS for every settings value but these (script/css-variants-plugin.ts), so they must
// be what production renders. Regenerate with `bun script/css-variants.ts`.
test("css-variants.json matches the default settings", () => {
  expect(variants as unknown).toEqual(cssVariants())
})

const config = resolveConfig({ configFile: false, logLevel: "silent", plugins: [cssVariantsForProduction()] }, "build")
const production = async (css: string) =>
  (await preprocessCSS(css, path.join(import.meta.dir, "fixture.css"), await config)).code.replace(/\s+/g, " ").trim()

test("production drops the CSS for other values of an element's settings attribute, nested rules too", async () => {
  // Card tone is "color" by default (settings-defaults.json); the root's logo is "icon".
  const css = await production(`
    [data-site] [data-component="products"] {
      &[data-tone="color"] a { color: red }
      &[data-tone="mono"] a { color: blue }
      &:not([data-tone="mono"]) b { color: green }
      [data-slot="media"] { &[data-active], [data-component="products"][data-tone="mono"] & { color: pink } }
    }
    [data-site]:is([data-logo="wordmark"], [data-logo="lockup"]) i { color: gray }
    [data-tone="mono"] u { color: teal }
  `)
  expect(css).toContain('&[data-tone="color"] a')
  expect(css).not.toContain('&[data-tone="mono"] a')
  expect(css).toContain(':not([data-tone="mono"]) b')
  expect(css).toContain('[data-slot="media"] { &[data-active] { color: pink } }')
  expect(css).not.toContain("gray")
  // Another element's data-tone is left alone.
  expect(css).toContain('[data-tone="mono"] u')
})

test("production drops the @keyframes nothing animates with any more", async () => {
  const css = await production(`
    @keyframes css-variants-test-kept { to { opacity: 1 } }
    @keyframes css-variants-test-dropped { to { opacity: 0 } }
    a { animation: css-variants-test-kept 1s }
    [data-site][data-logo="wordmark"] a { animation: css-variants-test-dropped 1s }
  `)
  expect(css).toContain("@keyframes css-variants-test-kept")
  expect(css).not.toContain("css-variants-test-dropped")
})

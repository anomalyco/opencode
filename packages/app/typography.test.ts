import { expect, test } from "bun:test"
import { createRequire } from "node:module"
import { typography } from "./typography.js"

// Use the same PostCSS implementation that runs the plugin in Vite.
const postcss = createRequire(import.meta.resolve("vite"))("postcss")

test("scales typography while preserving explicit geometry and decorations", () => {
  const root = postcss.parse(`
    :root { --font-size-small: 13px; --line-height-compact: 16px; --spacing: 0.25rem; --text-sm: 0.875rem; --text-sm--line-height: 1.5; }
    .row { font-size: 13px; height: 28px; padding: 4px 8px; gap: 0.5rem; line-height: 1.5; }
    .relative { font-size: 0.75rem; line-height: var(--line-height-compact); min-height: 1.75rem; }
    .square { width: 20px; height: 20px; border: 1px solid; border-radius: 4px; box-shadow: 0 1px 2px black; }
    .lines { line-height: 120%; --line-height-normal: 1.5em; }
    .viewport { height: 100dvh; width: 100%; margin: 0; background: url("/14px.png"); }
    .copy::after { content: "14px"; }
    @media (min-width: 768px) { .row { width: 160px; } }
  `)

  typography().OnceExit(root)
  const values: Record<string, string[]> = {}
  root.walkDecls((declaration: { prop: string; value: string }) => {
    ;(values[declaration.prop] ??= []).push(declaration.value)
  })

  expect(values["font-size"]).toEqual([
    "calc(13px * var(--app-font-size-scale, 1))",
    "calc(0.75rem * var(--app-font-size-scale, 1))",
  ])
  expect(values["--font-size-small"]).toEqual(["calc(13px * var(--app-font-size-scale, 1))"])
  expect(values["--text-sm"]).toEqual(["calc(0.875rem * var(--app-font-size-scale, 1))"])
  expect(values["--line-height-compact"]).toEqual([
    "calc(16px * var(--app-font-size-scale, 1) * var(--app-line-height-scale, 1))",
  ])
  expect(values["line-height"]).toEqual([
    "calc(1.5 * var(--app-line-height-scale, 1))",
    "var(--line-height-compact)",
    "calc(120% * var(--app-line-height-scale, 1))",
  ])
  expect(values["--text-sm--line-height"]).toEqual(["calc(1.5 * var(--app-line-height-scale, 1))"])
  expect(values["--line-height-normal"]).toEqual(["calc(1.5em * var(--app-line-height-scale, 1))"])
  expect(values.height).toEqual(["28px", "20px", "100dvh"])
  expect(values.width).toEqual(["20px", "100%", "160px"])
  expect(values["min-height"]).toEqual(["1.75rem"])
  expect(values.padding).toEqual(["4px 8px"])
  expect(values.gap).toEqual(["0.5rem"])
  expect(values["--spacing"]).toEqual(["0.25rem"])
  expect(values.border).toEqual(["1px solid"])
  expect(values["border-radius"]).toEqual(["4px"])
  expect(values["box-shadow"]).toEqual(["0 1px 2px black"])
  expect(values.background).toEqual(['url("/14px.png")'])
  expect(values.content).toEqual(['"14px"'])
  root.walkAtRules("media", (rule: { params: string }) => {
    expect(rule.params).toBe("(min-width: 768px)")
  })
})

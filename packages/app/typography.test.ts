import { expect, test } from "bun:test"
import { build } from "vite"
import { typography } from "./typography.js"

test("builds scalable typography and control geometry without rewriting viewport bounds or resource URLs", async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    css: { postcss: { plugins: [typography()] } },
    plugins: [{
      name: "typography-fixture",
      resolveId(id) {
        if (id === "typography-fixture" || id === "/typography-fixture.css") {
          return id
        }
      },
      load(id) {
        if (id === "typography-fixture") {
          return 'import "/typography-fixture.css"'
        }

        if (id === "/typography-fixture.css") {
          return `
            :root { --font-size-small: 13px; --line-height-compact: 16px; --spacing: 0.25rem; }
            .row { font-size: 13px; height: 28px; padding: 4px 8px; gap: 0.5rem; line-height: 1.5; }
            .relative { font-size: 0.75rem; line-height: var(--line-height-compact); min-height: 1.75rem; }
            .viewport { height: 100dvh; width: 100%; margin: 0; background: url("/14px.png"); }
            .copy::after { content: "14px"; }
            @media (min-width: 768px) { .row { width: 160px; } }
          `
        }
      },
    }],
    build: {
      write: false,
      copyPublicDir: false,
      minify: false,
      cssMinify: false,
      rolldownOptions: { input: "typography-fixture" },
    },
  })

  if (!("output" in result)) {
    throw new Error("Expected a single typography build")
  }

  const css = result.output.find(file => file.type === "asset" && file.fileName.endsWith(".css"))

  if (!css || css.type !== "asset") {
    throw new Error("Expected the built typography stylesheet")
  }

  const text = String(css.source)

  expect(text).toContain("--font-size-small: 0.8125rem")
  expect(text).toContain("height: calc(1.75rem * var(--app-line-height-scale, 1))")
  expect(text).toContain("gap: calc(0.5rem * var(--app-line-height-scale, 1))")
  expect(text).toContain("line-height: calc(1.5 * var(--app-line-height-scale, 1))")
  expect(text).toContain("font-size: 0.75rem")
  expect(text).toContain("line-height: var(--line-height-compact)")
  expect(text).toContain("height: 100dvh")
  expect(text).toContain("width: 100%")
  expect(text).toContain("margin: 0")
  expect(text).toContain("14px.png")
  expect(text).toContain('content: "14px"')
  expect(text).toContain("min-width: 768px")
})

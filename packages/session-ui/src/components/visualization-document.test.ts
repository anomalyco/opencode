import { describe, expect, test } from "bun:test"
import { createVisualizationDocument } from "./visualization-document"

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src data: blob:; object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none';"

describe("createVisualizationDocument", () => {
  const html = '<button id="go">Go</button><script>window.demo = true</script>'

  test("returns a deterministic full document with CSP as the first head item", () => {
    const first = createVisualizationDocument(html)
    const second = createVisualizationDocument(html)
    expect(first).toBe(second)
    expect(first).toStartWith('<!doctype html><html style="background: transparent !important"><head><meta')
    expect(first).toContain(`http-equiv="Content-Security-Policy" content="${CSP}"`)
    expect(first.indexOf("Content-Security-Policy")).toBeLessThan(first.indexOf(html))
    expect(first).not.toContain("http:")
    expect(first).not.toContain("https:")
  })

  test("places the bridge before the unchanged agent fragment exactly once", () => {
    const document = createVisualizationDocument(html)
    expect(document.indexOf("window.opencode")).toBeLessThan(document.indexOf(html))
    expect(document.split(html)).toHaveLength(2)
    expect(document).not.toContain("sessionID")
    expect(document).not.toContain("__TOKEN__")
  })

  test("wraps the fragment in a Codex-style transparent host canvas", () => {
    const fragment =
      '<style>html, body { background: white !important }</style><main style="background: red">Card</main>'
    const document = createVisualizationDocument(fragment)

    expect(document).toStartWith('<!doctype html><html style="background: transparent !important"><head>')
    expect(document).toContain('<body style="margin: 0; background: transparent !important">')
    expect(document).toContain(":root {\n  color-scheme: light dark;\n  background: transparent !important;")
    expect(document).toContain("--background: var(--v2-background-bg-base, transparent);")
    expect(document).toContain("--foreground: var(--v2-text-text-base, currentColor);")
    expect(document).toContain("html > body")
    expect(document).toContain("#widget {\n  display: flex;")
    expect(document).toContain("#widget > :not(.card)")
    expect(document).toContain("background: transparent !important;")
    expect(document).toContain("box-shadow: none !important;")
    expect(document).toContain(`<div id="widget">${fragment}</div>`)
    expect(document.split(fragment)).toHaveLength(2)
  })

  test("installs only the follow-up public bridge before initialization", () => {
    const document = createVisualizationDocument(html)
    expect(document).toContain("window.opencode.visualization.sendFollowUp")
    expect(document).toContain("await waitForInitialization()")
    expect(document).not.toContain("window.opencode.visualization.resize")
    expect(document).not.toContain("window.opencode.visualization.rpc")
  })

  test("contains the bounded source-checked message protocol", () => {
    const document = createVisualizationDocument(html)
    expect(document).toContain("event.source !== parent")
    expect(document).toContain('message.type === "init"')
    expect(document).toContain('message.type === "theme"')
    expect(document).toContain('message.type === "followup-result"')
    expect(document).toContain('type: "ready"')
    expect(document).toContain('type: "resize"')
    expect(document).toContain('type: "followup"')
    expect(document).toContain('type: "error"')
    expect(document).toContain('status === "sent"')
    expect(document).toContain('status === "cancelled"')
    expect(document).toContain('status === "rejected"')
  })

  test("defers the last pre-init error until after ready without posting tokenless messages", () => {
    const document = createVisualizationDocument(html)
    expect(document).toContain("let deferredError")
    expect(document).toContain("if (!token) {\n      deferredError = message")
    expect(document).toContain('post({ type: "ready" })')
    expect(document).toContain('post({ type: "error", message: deferredError })')
    expect(document.indexOf('post({ type: "ready" })')).toBeLessThan(
      document.indexOf('post({ type: "error", message: deferredError })'),
    )
  })

  test("bounds initialization and follow-up waits and settles lifecycle cleanup", () => {
    const document = createVisualizationDocument(html)
    expect(document).toContain("initTimeout: 10000")
    expect(document).toContain("responseTimeout: 30000")
    expect(document).toContain('resolve({ status: "rejected" })')
    expect(document).toContain("clearTimeout(pendingFollowUp.timer)")
    expect(document).toContain('addEventListener("pagehide", dispose')
    expect(document).toContain('addEventListener("beforeunload", dispose')
  })

  test("coalesces resize reports with ResizeObserver and requestAnimationFrame", () => {
    const document = createVisualizationDocument(html)
    expect(document).toContain("new ResizeObserver(scheduleResize)")
    expect(document).toContain("cancelAnimationFrame(resizeFrame)")
    expect(document).toContain("requestAnimationFrame(reportResize)")
    expect(document).toContain("let lastReportedHeight")
    expect(document).toContain("height === lastReportedHeight")
    expect(document).toContain("Number.isFinite(height)")
  })

  test("applies only the fixed theme variables", () => {
    const document = createVisualizationDocument(html)
    for (const name of [
      "--v2-background-bg-base",
      "--v2-background-bg-layer-01",
      "--v2-text-text-base",
      "--v2-text-text-muted",
      "--v2-border-border-base",
      "--v2-text-text-accent",
      "--font-family-sans",
      "--font-family-mono",
    ]) {
      expect(document).toContain(`"${name}"`)
    }
    expect(document).toContain("Array.from(value).length <= config.themeValueLimit")
  })

  test("bounds runtime error and rejection reports", () => {
    const document = createVisualizationDocument(html)
    expect(document).toContain('addEventListener("error"')
    expect(document).toContain('addEventListener("unhandledrejection"')
    expect(document).toContain("Array.from(cleaned).slice(0, config.errorLimit).join")
    expect(document).toContain('replace(/\\s+/g, " ")')
  })
})

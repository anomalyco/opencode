import { describe, expect, test } from "bun:test"
import {
  clampMermaidZoom,
  fitMermaidCamera,
  isMermaidLanguage,
  stepMermaidZoom,
  zoomMermaidCamera,
} from "./markdown-mermaid"
import { mermaidThemeVariables } from "./markdown-mermaid-theme"

describe("isMermaidLanguage", () => {
  test("matches mermaid fences case-insensitively", () => {
    expect(isMermaidLanguage("mermaid")).toBe(true)
    expect(isMermaidLanguage("Mermaid")).toBe(true)
    expect(isMermaidLanguage("  mermaid  ")).toBe(true)
  })

  test("ignores other languages", () => {
    expect(isMermaidLanguage("ts")).toBe(false)
    expect(isMermaidLanguage("markdown")).toBe(false)
    expect(isMermaidLanguage("")).toBe(false)
    expect(isMermaidLanguage(undefined)).toBe(false)
  })
})

describe("mermaidThemeVariables", () => {
  test("every color is concrete hex so mermaid's color derivation cannot throw", () => {
    for (const scheme of ["light", "dark"] as const) {
      for (const [key, value] of Object.entries(mermaidThemeVariables(scheme))) {
        if (key === "darkMode") continue
        expect(value).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })

  test("light and dark variants define the same tokens with different values", () => {
    const light = mermaidThemeVariables("light")
    const dark = mermaidThemeVariables("dark")
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort())
    expect(light.mainBkg).not.toBe(dark.mainBkg)
    expect(light.darkMode).toBe(false)
    expect(dark.darkMode).toBe(true)
  })

  test("categorical scales stay distinct for parsing large charts", () => {
    for (const scheme of ["light", "dark"] as const) {
      const theme = mermaidThemeVariables(scheme)
      const scale = Array.from({ length: 8 }, (_, index) => theme[`cScale${index}`])
      expect(new Set(scale).size).toBe(scale.length)
      expect(scale.every((color) => typeof color === "string")).toBe(true)
      expect(theme.git0).toBe(theme.cScale0)
    }
  })
})

describe("mermaid viewer camera", () => {
  test("steps zoom multiplicatively within limits", () => {
    expect(stepMermaidZoom(1, 1)).toBe(1.25)
    expect(stepMermaidZoom(1.25, -1)).toBe(1)
    expect(stepMermaidZoom(8, 1)).toBe(8)
    expect(stepMermaidZoom(0.1, -1)).toBe(0.1)
  })

  test("clamps arbitrary zoom values", () => {
    expect(clampMermaidZoom(100)).toBe(8)
    expect(clampMermaidZoom(0)).toBe(0.1)
    expect(clampMermaidZoom(2)).toBe(2)
  })

  test("fit fills the padded canvas and centers the diagram", () => {
    const fit = fitMermaidCamera({ width: 400, height: 300 }, { width: 896, height: 696 })
    expect(fit.zoom).toBe(2)
    expect(fit.x).toBe(48)
    expect(fit.y).toBe(48)
  })

  test("fit shrinks oversized diagrams and survives degenerate sizes", () => {
    expect(fitMermaidCamera({ width: 3200, height: 300 }, { width: 896, height: 696 }).zoom).toBe(0.25)
    expect(fitMermaidCamera({ width: 0, height: 0 }, { width: 896, height: 696 })).toEqual({ zoom: 1, x: 0, y: 0 })
  })

  test("zooming keeps the content under the anchor point stationary", () => {
    const camera = { zoom: 1, x: 0, y: 0 }
    const zoomed = zoomMermaidCamera(camera, 2, { x: 100, y: 100 })
    expect(zoomed).toEqual({ zoom: 2, x: -100, y: -100 })
    // The content point that was at screen (100, 100) is still at (100, 100).
    expect(((100 - zoomed.x) / zoomed.zoom) * zoomed.zoom + zoomed.x).toBe(100)
    const back = zoomMermaidCamera(zoomed, 1, { x: 100, y: 100 })
    expect(back).toEqual({ zoom: 1, x: 0, y: 0 })
  })
})

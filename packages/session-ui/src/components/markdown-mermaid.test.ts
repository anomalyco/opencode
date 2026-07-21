import { describe, expect, test } from "bun:test"
import { clampMermaidZoom, fitMermaidZoom, isMermaidLanguage, mermaidThemeFor, stepMermaidZoom } from "./markdown-mermaid"

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

describe("mermaidThemeFor", () => {
  test("maps the app color scheme to a mermaid theme", () => {
    expect(mermaidThemeFor("dark")).toBe("dark")
    expect(mermaidThemeFor("light")).toBe("default")
  })
})

describe("mermaid viewer zoom", () => {
  test("steps zoom multiplicatively within limits", () => {
    expect(stepMermaidZoom(1, 1)).toBe(1.25)
    expect(stepMermaidZoom(1.25, -1)).toBe(1)
    expect(stepMermaidZoom(8, 1)).toBe(8)
    expect(stepMermaidZoom(0.25, -1)).toBe(0.25)
  })

  test("clamps arbitrary zoom values", () => {
    expect(clampMermaidZoom(100)).toBe(8)
    expect(clampMermaidZoom(0)).toBe(0.25)
    expect(clampMermaidZoom(2)).toBe(2)
  })

  test("fits diagrams to the viewport without upscaling", () => {
    expect(fitMermaidZoom({ width: 400, height: 300 }, { width: 800, height: 600 })).toBe(1)
    expect(fitMermaidZoom({ width: 1600, height: 300 }, { width: 800, height: 600 })).toBe(0.5)
    expect(fitMermaidZoom({ width: 400, height: 1200 }, { width: 800, height: 600 })).toBe(0.5)
    expect(fitMermaidZoom({ width: 0, height: 0 }, { width: 800, height: 600 })).toBe(1)
  })
})

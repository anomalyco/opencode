import { describe, expect, test } from "bun:test"
import { isMermaidLanguage, mermaidThemeFor } from "./markdown-mermaid"

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

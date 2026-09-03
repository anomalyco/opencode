import { describe, expect, test } from "bun:test"
import { isMermaidLanguage } from "./mermaid"

describe("mermaid", () => {
  test("detects mermaid language regardless of case", () => {
    expect(isMermaidLanguage("mermaid")).toBe(true)
    expect(isMermaidLanguage("Mermaid")).toBe(true)
    expect(isMermaidLanguage("MERMAID")).toBe(true)
  })

  test("rejects other languages", () => {
    expect(isMermaidLanguage("ts")).toBe(false)
    expect(isMermaidLanguage("")).toBe(false)
    expect(isMermaidLanguage(undefined)).toBe(false)
  })
})

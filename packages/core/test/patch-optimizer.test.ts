import { describe, expect, it } from "bun:test"
import {
  findOccurrencesWithContext,
  formatDisambiguationPrompt,
  fuzzyLineTrimMatch,
  cleanTrailingWhitespace,
} from "../src/tool/patch-optimizer"

describe("Surgical Patch Optimizer", () => {
  describe("findOccurrencesWithContext", () => {
    const sampleCode = [
      "import { Effect } from 'effect'",
      "",
      "export function firstHandler() {",
      "  const isValid = checkValidity()",
      "  if (!isValid) return false",
      "  return true",
      "}",
      "",
      "export function secondHandler() {",
      "  const isValid = checkSecondary()",
      "  if (!isValid) return false",
      "  return true",
      "}",
    ].join("\n")

    it("identifies line numbers for all occurrences of ambiguous target", () => {
      const search = "  if (!isValid) return false"
      const occurrences = findOccurrencesWithContext(sampleCode, search)

      expect(occurrences).toHaveLength(2)
      expect(occurrences[0]!.lineNumber).toBe(5)
      expect(occurrences[1]!.lineNumber).toBe(11)
    })

    it("captures surrounding lines for disambiguation", () => {
      const search = "  if (!isValid) return false"
      const occurrences = findOccurrencesWithContext(sampleCode, search, 1)

      expect(occurrences[0]!.contextAbove).toContain("  const isValid = checkValidity()")
      expect(occurrences[0]!.contextBelow).toContain("  return true")

      expect(occurrences[1]!.contextAbove).toContain("  const isValid = checkSecondary()")
      expect(occurrences[1]!.contextBelow).toContain("  return true")
    })

    it("formats a concise disambiguation prompt for the model", () => {
      const search = "  if (!isValid) return false"
      const occurrences = findOccurrencesWithContext(sampleCode, search, 1)
      const prompt = formatDisambiguationPrompt(occurrences, search)

      expect(prompt).toContain("Context for each match to help disambiguate")
      expect(prompt).toContain("Match 1 at line 5")
      expect(prompt).toContain("Match 2 at line 11")
      expect(prompt).toContain("checkValidity()")
      expect(prompt).toContain("checkSecondary()")
      expect(prompt).toContain("include 1 unique surrounding line")
    })
  })

  describe("fuzzyLineTrimMatch", () => {
    const fileContent = [
      "export function computeTax(amount: number): number {",
      "  const rate = 0.21;   ", // note trailing whitespace here
      "  return amount * rate;",
      "}",
    ].join("\n")

    it("matches when oldString lacks trailing spaces present in the file", () => {
      const searchWithoutTrailing = "  const rate = 0.21;"
      const result = fuzzyLineTrimMatch(fileContent, searchWithoutTrailing)

      expect(result.matched).toBe(true)
      expect(result.actualSubstring).toBe("  const rate = 0.21;   ")
    })

    it("matches when oldString has trailing spaces not present in the file", () => {
      const fileNoTrailing = "  const tax = 100;"
      const searchWithTrailing = "  const tax = 100;    "
      const result = fuzzyLineTrimMatch(fileNoTrailing, searchWithTrailing)

      expect(result.matched).toBe(true)
      expect(result.actualSubstring).toBe("  const tax = 100;")
    })

    it("matches multi-line blocks with trailing whitespace differences", () => {
      const fileMulti = [
        "function handleRequest() {  ",
        "  validate();",
        "  proceed();   ",
        "}",
      ].join("\n")

      const searchMulti = [
        "function handleRequest() {",
        "  validate();",
        "  proceed();",
        "}",
      ].join("\n")

      const result = fuzzyLineTrimMatch(fileMulti, searchMulti)
      expect(result.matched).toBe(true)
      expect(result.actualSubstring).toBe(fileMulti)
    })

    it("returns matched: false when content is genuinely different", () => {
      const searchDifferent = "  const rate = 0.15;"
      const result = fuzzyLineTrimMatch(fileContent, searchDifferent)

      expect(result.matched).toBe(false)
      expect(result.actualSubstring).toBeUndefined()
    })
  })

  describe("cleanTrailingWhitespace", () => {
    it("removes trailing spaces while preserving line breaks", () => {
      const dirty = "const a = 1;   \nconst b = 2;  \r\nconst c = 3;\t  \n"
      const cleaned = cleanTrailingWhitespace(dirty)

      expect(cleaned).toBe("const a = 1;\nconst b = 2;\r\nconst c = 3;\n")
    })
  })
})

import { describe, expect, it } from "bun:test"
import { TextFormat } from "@/format/text"

describe("TextFormat", () => {
  describe("formatMarkdownTables", () => {
    it("should format a simple table", () => {
      const input = `
| Name | Age | City |
|------|-----|------|
| John | 30  | NYC  |
| Jane | 25  | LA   |
`
      const result = TextFormat.formatMarkdownTables(input)
      expect(result).toContain("| Name | Age | City |")
      expect(result).toContain("| John | 30  | NYC  |")
      expect(result).toContain("| Jane | 25  | LA   |")
    })

    it("should format a table with alignment", () => {
      const input = `
| Left | Center | Right |
|:-----|:------:|------:|
| L1   | C1     | R1    |
| L2   | C2     | R2    |
`
      const result = TextFormat.formatMarkdownTables(input)
      expect(result).toContain("| Left | Center | Right |")
      expect(result).toContain("| ---- | :----: | ----: |")
      expect(result).toContain("| L1   |   C1   |    R1 |")
    })

    it("should not modify non-table content", () => {
      const input = `
Some text

| A | B |
|---|---|
| 1 | 2 |

More text
`
      const result = TextFormat.formatMarkdownTables(input)
      expect(result).toContain("Some text")
      expect(result).toContain("More text")
      expect(result).toContain("| A   | B   |")
    })

    it("should format a table with alignment", () => {
      const input = `
| Left | Center | Right |
|:-----|:------:|------:|
| L1   | C1     | R1    |
| L2   | C2     | R2    |
`
      const result = TextFormat.formatMarkdownTables(input)
      expect(result).toContain("| Left | Center | Right |")
      expect(result).toContain("| ---- | :----: | ----: |")
      expect(result).toContain("| L1   |   C1   |    R1 |")
    })

    it("should not modify non-table content", () => {
      const input = `
Some text

| A | B |
|---|---|
| 1 | 2 |

More text
`
      const result = TextFormat.formatMarkdownTables(input)
      expect(result).toContain("Some text")
      expect(result).toContain("More text")
      expect(result).toContain("| A   | B   |")
    })

    it("should not modify non-table content", () => {
      const input = `
Some text

| A | B |
|---|---|
| 1 | 2 |

More text
`
      const result = TextFormat.formatMarkdownTables(input)
      expect(result).toContain("Some text")
      expect(result).toContain("More text")
      expect(result).toContain("| A   | B   |")
    })

    it("should handle invalid tables gracefully", () => {
      const input = `
| A | B |
|---|
| 1 | 2 |
`
      const result = TextFormat.formatMarkdownTables(input)
      expect(result).toContain("<!-- table not formatted: invalid structure -->")
    })

    it("should handle tables with markdown in cells", () => {
      const input = `
| Name | Description |
|------|-------------|
| **Bold** | *Italic* |
| code | normal |
`
      const result = TextFormat.formatMarkdownTables(input)
      expect(result).toContain("**Bold**")
      expect(result).toContain("*Italic*")
      expect(result).toContain("code")
    })

    it("should format a table with emojis", () => {
      const input = `
| Item | Status |
|------|--------|
| ✅   | Done   |
| 🚧   | Work   |
`
      const result = TextFormat.formatMarkdownTables(input)
      expect(result).toContain("✅")
      expect(result).toContain("🚧")
      expect(result).toContain("| Item | Status |")
    })
  })
})

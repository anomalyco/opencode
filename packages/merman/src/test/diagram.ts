import { expect } from "bun:test"

function normalizeDiagram(value: string): string {
  const lines = value.replace(/\r\n/g, "\n").split("\n")
  while (lines[0]?.trim() === "") lines.shift()
  while (lines[lines.length - 1]?.trim() === "") lines.pop()
  const indentation = lines
    .filter((line) => line.trim().length > 0)
    .reduce((min, line) => Math.min(min, line.match(/^\s*/)?.[0].length ?? 0), Number.POSITIVE_INFINITY)
  const trimBy = Number.isFinite(indentation) ? indentation : 0
  return lines.map((line) => line.slice(trimBy)).join("\n")
}

export function expectDiagram(value: string): {
  toEqualDiagram(expected: string): void
  toContainInOrder(...needles: string[]): void
} {
  return {
    toEqualDiagram(expected) {
      expect(value).toBe(normalizeDiagram(expected))
    },
    toContainInOrder(...needles) {
      let offset = -1
      for (const needle of needles) {
        const searchSpace = value.slice(offset + 1)
        expect(searchSpace).toContain(needle)
        const nextOffset = value.indexOf(needle, offset + 1)
        offset = nextOffset
      }
    },
  }
}

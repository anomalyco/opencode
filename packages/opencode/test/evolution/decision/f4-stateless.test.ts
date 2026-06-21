import { describe, expect, test } from "bun:test"
import { readFileSync } from "fs"

describe("TG-STATELESS — DecisionEngine module statelessness", () => {
  const engineSrc = readFileSync(
    new URL("../../../src/evolution/decision/engine.ts", import.meta.url),
    "utf-8",
  )

  const lines = engineSrc.split("\n")

  test("no mutable variable declarations (let / var)", () => {
    for (const [i, line] of lines.entries()) {
      if (/^\s*(let|var)\s/.test(line)) {
        throw new Error(`line ${i + 1}: mutable declaration forbidden: ${line.trim()}`)
      }
    }
  })

  test("no mutable collections (new Map, new Set)", () => {
    for (const [i, line] of lines.entries()) {
      if (/\bnew\s+(Map|Set)\b/.test(line)) {
        throw new Error(`line ${i + 1}: mutable collection forbidden: ${line.trim()}`)
      }
    }
  })

  test("all top-level module bindings are const", () => {
    for (const [i, line] of lines.entries()) {
      const trimmed = line.trim()
      if (/^(export\s+)?(let|var)\s/.test(trimmed)) {
        throw new Error(`line ${i + 1}: top-level mutable declaration: ${trimmed}`)
      }
    }
  })
})

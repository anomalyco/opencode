import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { EXTRACTION_SYSTEM, CONSOLIDATION_SYSTEM } from "../../src/core/prompts"

describe("prompts (verbatim spec §10)", () => {
  test("extraction system matches spec", () => {
    const spec = readFileSync(path.resolve(import.meta.dirname, "../../docs/spec.md"), "utf8")
    // Extract the fenced block between "### 10.1 EXTRACTION_SYSTEM" and "### 10.2"
    const start = spec.indexOf("### 10.1 EXTRACTION_SYSTEM")
    const end = spec.indexOf("### 10.2 CONSOLIDATION_SYSTEM")
    const section = spec.slice(start, end)
    // The prompt is the fenced code block content.
    const fenceStart = section.indexOf("```\n") + 4
    const fenceEnd = section.indexOf("\n```", fenceStart)
    const expected = section.slice(fenceStart, fenceEnd)
    expect(EXTRACTION_SYSTEM).toBe(expected)
  })

  test("consolidation system matches spec", () => {
    const spec = readFileSync(path.resolve(import.meta.dirname, "../../docs/spec.md"), "utf8")
    const start = spec.indexOf("### 10.2 CONSOLIDATION_SYSTEM")
    const section = spec.slice(start)
    const fenceStart = section.indexOf("```\n") + 4
    const fenceEnd = section.indexOf("\n```", fenceStart)
    const expected = section.slice(fenceStart, fenceEnd)
    expect(CONSOLIDATION_SYSTEM).toBe(expected)
  })
})

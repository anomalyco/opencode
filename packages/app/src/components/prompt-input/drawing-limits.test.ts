import { describe, expect, test } from "bun:test"
import {
  DRAW_FILES_MAX_BYTES,
  DRAW_IMAGE_MAX_COUNT,
  filesBytes,
  filesCount,
  filesWithinBudget,
} from "./drawing-limits"

describe("drawing-limits", () => {
  test("filesWithinBudget allows empty files", () => {
    expect(filesWithinBudget({})).toBe(true)
  })

  test("filesWithinBudget rejects too many files", () => {
    const files: Record<string, { dataURL: string; mimeType: string }> = {}
    for (let i = 0; i < DRAW_IMAGE_MAX_COUNT + 1; i++) {
      files[`id-${i}`] = { dataURL: "data:image/png;base64,AA==", mimeType: "image/png" }
    }
    expect(filesCount(files)).toBe(DRAW_IMAGE_MAX_COUNT + 1)
    expect(filesWithinBudget(files)).toBe(false)
  })

  test("filesWithinBudget rejects total bytes over cap", () => {
    const chunk = "a".repeat(DRAW_FILES_MAX_BYTES + 1)
    const files = {
      a: { dataURL: chunk, mimeType: "image/png" },
    }
    expect(filesBytes(files)).toBeGreaterThan(DRAW_FILES_MAX_BYTES)
    expect(filesWithinBudget(files)).toBe(false)
  })
})

import { describe, expect, test } from "bun:test"
import { deduplicatePromptFiles, promptAttachmentLabel } from "../../src/prompt/attachment"

describe("prompt attachments", () => {
  test("deduplicates identical attachment data while preserving order", () => {
    const files = [
      { uri: "data:image/png;base64,AAA", name: "first.png" },
      { uri: "data:image/png;base64,BBB", name: "second.png" },
      { uri: "data:image/png;base64,AAA", name: "duplicate.png" },
    ]

    expect(deduplicatePromptFiles(files)).toEqual(files.slice(0, 2))
    expect(files).toHaveLength(3)
  })

  test("reuses labels for identical image data", () => {
    const first = "data:image/png;base64,AAA"
    const second = "data:image/png;base64,BBB"
    const files = [{ uri: first, mention: { start: 0, end: 9, text: "[Image 1]" } }]

    expect(promptAttachmentLabel(files, first)).toBe("[Image 1]")
    expect(promptAttachmentLabel([...files, { ...files[0], mention: undefined }], second)).toBe("[Image 2]")
  })

  test("numbers PDFs independently from images", () => {
    const files = [{ uri: "data:image/png;base64,AAA" }]

    expect(promptAttachmentLabel(files, "data:application/pdf;base64,BBB")).toBe("[PDF 1]")
  })
})

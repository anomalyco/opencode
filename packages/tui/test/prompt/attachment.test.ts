import { describe, expect, test } from "bun:test"
import { deduplicatePromptAttachments, promptAttachmentLabel } from "../../src/prompt/attachment"

describe("prompt attachments", () => {
  test("deduplicates identical inline media while preserving other attachments", () => {
    const files = [
      { uri: "data:image/png;base64,AAA", name: "first.png" },
      { uri: "file:///same", name: "first.txt" },
      { uri: "data:application/pdf;base64,CCC", name: "first.pdf" },
      { uri: "data:image/png;base64,BBB", name: "second.png" },
      { uri: "data:image/png;base64,AAA", name: "duplicate.png" },
      { uri: "file:///same", name: "second.txt" },
      { uri: "data:application/pdf;base64,CCC", name: "duplicate.pdf" },
    ]

    expect(deduplicatePromptAttachments(files)).toEqual([files[0], files[1], files[2], files[3], files[5]])
    expect(files).toHaveLength(7)
  })

  test("reuses labels for identical image data", () => {
    const first = "data:image/png;base64,AAA"
    const second = "data:image/png;base64,BBB"
    const files = [{ uri: first, mention: { start: 0, end: 9, text: "[Image 1]" } }]

    expect(promptAttachmentLabel(files, first)).toBe("[Image 1]")
    expect(promptAttachmentLabel([...files, { ...files[0], mention: undefined }], second)).toBe("[Image 2]")
  })

  test("numbers PDFs independently from images", () => {
    const first = "data:application/pdf;base64,BBB"
    const second = "data:application/pdf;base64,CCC"
    const files = [
      { uri: "data:image/png;base64,AAA" },
      { uri: first, mention: { start: 10, end: 17, text: "[PDF 1]" } },
    ]

    expect(promptAttachmentLabel(files, first)).toBe("[PDF 1]")
    expect(promptAttachmentLabel([...files, { ...files[1], mention: undefined }], second)).toBe("[PDF 2]")
  })
})

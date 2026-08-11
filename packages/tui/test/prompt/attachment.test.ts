import { describe, expect, test } from "bun:test"
import {
  deduplicatePromptImages,
  deduplicateVisibleImages,
  preserveMentionlessPromptAttachments,
  promptAttachmentLabel,
} from "../../src/prompt/attachment"

describe("prompt attachments", () => {
  test("deduplicates identical inline images while preserving other attachments", () => {
    const files = [
      { uri: "data:image/png;base64,AAA", name: "first.png" },
      { uri: "file:///same", name: "first.txt" },
      { uri: "data:application/pdf;base64,CCC", name: "first.pdf" },
      { uri: "data:image/png;base64,BBB", name: "second.png" },
      { uri: "data:image/png;base64,AAA", name: "first.png" },
      { uri: "data:image/png;base64,AAA", name: "first.png", description: "alternate use" },
      { uri: "file:///same", name: "second.txt" },
      { uri: "data:application/pdf;base64,CCC", name: "first.pdf" },
    ]

    expect(deduplicatePromptImages(files)).toEqual([
      files[0],
      files[1],
      files[2],
      files[3],
      files[5],
      files[6],
      files[7],
    ])
    expect(files).toHaveLength(8)
  })

  test("reuses labels for identical image data", () => {
    const first = "data:image/png;base64,AAA"
    const second = "data:image/png;base64,BBB"
    const files = [{ uri: first, mention: { start: 0, end: 9, text: "[Image 1]" } }]

    expect(promptAttachmentLabel(files, { uri: first })).toBe("[Image 1]")
    expect(promptAttachmentLabel([...files, { ...files[0], mention: undefined }], { uri: second })).toBe("[Image 2]")
    expect(promptAttachmentLabel([{ uri: first }], { uri: first })).toBe("[Image 1]")
  })

  test("numbers PDFs independently from images", () => {
    const files = [{ uri: "data:image/png;base64,AAA" }]

    expect(promptAttachmentLabel(files, { uri: "data:application/pdf;base64,BBB" })).toBe("[PDF 1]")
  })

  test("does not reuse a label when attachment metadata differs", () => {
    const uri = "data:image/png;base64,AAA"
    const files = [{ uri, name: "one.png", mention: { start: 0, end: 9, text: "[Image 1]" } }]

    expect(promptAttachmentLabel(files, { uri, name: "two.png" })).toBe("[Image 2]")
  })

  test("does not reuse numbers after an earlier attachment is removed", () => {
    const files = [{ uri: "data:image/png;base64,BBB", mention: { start: 0, end: 9, text: "[Image 2]" } }]

    expect(promptAttachmentLabel(files, { uri: "data:image/png;base64,CCC" })).toBe("[Image 3]")
  })

  test("preserves mentionless attachments when tracked mentions are synchronized", () => {
    const mentionless = { uri: "data:image/png;base64,AAA" }
    const mentioned = {
      uri: "data:image/png;base64,BBB",
      mention: { start: 0, end: 9, text: "[Image 1]" },
    }

    expect(preserveMentionlessPromptAttachments([mentionless, mentioned], [mentioned])).toEqual([
      mentioned,
      mentionless,
    ])
  })

  test("deduplicates visible inline image cards without dropping durable references", () => {
    const file = {
      data: "AAA",
      mime: "image/png",
      source: { type: "inline" },
      name: "clipboard",
      mention: { text: "[Image 1]" },
    }
    const files = [file, { ...file, mention: { text: "[Image 1]" } }]

    expect(deduplicateVisibleImages(files)).toEqual([file])
    expect(files).toHaveLength(2)
  })
})

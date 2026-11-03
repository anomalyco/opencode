import { describe, expect, test } from "bun:test"
import type { PromptFileAttachment } from "@opencode/client/promise"
import { attached, imageAttachmentPlaceholderStyle, MIN_IMAGE_PLACEHOLDER_PX, typeLabel } from "./message-file"

function file(source: PromptFileAttachment["source"], mention = false): PromptFileAttachment {
  const item: PromptFileAttachment = {
    data: "",
    mime: "text/plain",
    source,
  }

  if (mention) item.mention = { text: "@README.md", start: 0, end: 10 }

  return item
}

describe("message-file", () => {
  test("only treats data-backed files without mentions as attachments", () => {
    expect(attached(file({ type: "inline" }))).toBe(true)
    expect(attached(file({ type: "uri", uri: "data:text/plain;base64,SGVsbG8=" }))).toBe(true)
    expect(attached(file({ type: "uri", uri: "blob:http://localhost/image-1" }))).toBe(true)
    expect(attached(file({ type: "uri", uri: "file:///repo/README.md" }))).toBe(false)
    expect(attached(file({ type: "inline" }, true))).toBe(false)
  })

  test("labels attachment types from the basename extension", () => {
    expect(typeLabel("list.md", "text/plain", "File")).toBe("Markdown")
    expect(typeLabel("/repo/src/main.ts", "text/plain", "File")).toBe("TypeScript")
    expect(typeLabel("/tmp/report.pdf", "application/pdf", "File")).toBe("PDF")
    expect(typeLabel("notes.xyz", "text/plain", "File")).toBe("XYZ")
    expect(typeLabel("/home/user/my.project/Makefile", "text/plain", "File")).toBe("File")
    expect(typeLabel(".gitignore", "text/plain", "File")).toBe("File")
    expect(typeLabel("/repo/.env", "text/plain", "File")).toBe("File")
  })

  test("keeps a sane minimum placeholder size on 401/error when width and height are missing", () => {
    expect(imageAttachmentPlaceholderStyle({ loaded: false })).toEqual({
      "min-width": `${MIN_IMAGE_PLACEHOLDER_PX}px`,
      "min-height": `${MIN_IMAGE_PLACEHOLDER_PX}px`,
    })
    expect(imageAttachmentPlaceholderStyle({ width: 800, height: 600, loaded: false })).toEqual({
      "aspect-ratio": "800 / 600",
      "min-width": `${MIN_IMAGE_PLACEHOLDER_PX}px`,
      "min-height": `${MIN_IMAGE_PLACEHOLDER_PX}px`,
    })
    expect(imageAttachmentPlaceholderStyle({ width: 800, height: 600, loaded: true })).toEqual({
      "aspect-ratio": "800 / 600",
    })
  })
})

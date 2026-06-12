import { describe, expect, mock, test } from "bun:test"
import { readLocalAttachmentWith } from "../../src/component/prompt/local-attachment"
import type { LocalFiles } from "../../src/component/prompt/local-attachment"
import { DOCX_MIME, XLSX_MIME } from "../../src/component/prompt/office-converter"

// Mock the office-converter module so tests don't need real Office files
mock.module("../../src/component/prompt/office-converter", () => ({
  DOCX_MIME,
  XLSX_MIME,
  convertOfficeFile: async (bytes: Uint8Array, mime: string) => {
    if (bytes.length === 0) return undefined
    if (mime === DOCX_MIME) return "# Hello\n\nThis is a Word document."
    if (mime === XLSX_MIME) return "## Sheet: Sheet1\n\n| A | B |\n| --- | --- |\n| 1 | 2 |"
    return undefined
  },
}))

function files(input: { mime: string; text?: string; bytes?: Uint8Array }): LocalFiles {
  return {
    mime: async () => input.mime,
    readText: async () => input.text ?? "",
    readBytes: async () => input.bytes ?? new Uint8Array(),
  }
}

describe("prompt local attachments", () => {
  test("reads SVG attachments as text", async () => {
    expect(await readLocalAttachmentWith(files({ mime: "image/svg+xml", text: "<svg />" }), "/tmp/image.svg")).toEqual({
      type: "text",
      mime: "image/svg+xml",
      content: "<svg />",
    })
  })

  test("reads image and PDF attachments as bytes", async () => {
    const content = new Uint8Array([1, 2, 3])
    expect(await readLocalAttachmentWith(files({ mime: "application/pdf", bytes: content }), "/tmp/file.pdf")).toEqual({
      type: "binary",
      mime: "application/pdf",
      content,
    })
  })

  test("converts .docx attachments to office text", async () => {
    const content = new Uint8Array([1, 2, 3])
    const result = await readLocalAttachmentWith(files({ mime: DOCX_MIME, bytes: content }), "/tmp/document.docx")
    expect(result?.type).toBe("office")
    if (result?.type === "office") {
      expect(result.mime).toBe(DOCX_MIME)
      expect(result.filename).toBe("document.docx")
      expect(result.content).toContain("Word document")
    }
  })

  test("converts .xlsx attachments to office text", async () => {
    const content = new Uint8Array([1, 2, 3])
    const result = await readLocalAttachmentWith(files({ mime: XLSX_MIME, bytes: content }), "/tmp/sheet.xlsx")
    expect(result?.type).toBe("office")
    if (result?.type === "office") {
      expect(result.mime).toBe(XLSX_MIME)
      expect(result.filename).toBe("sheet.xlsx")
      expect(result.content).toContain("Sheet1")
    }
  })

  test("returns undefined when office conversion yields no content", async () => {
    // Empty bytes → mock returns undefined
    const result = await readLocalAttachmentWith(files({ mime: DOCX_MIME, bytes: new Uint8Array() }), "/tmp/empty.docx")
    expect(result).toBeUndefined()
  })

  test("ignores unsupported and unreadable local files", async () => {
    expect(await readLocalAttachmentWith(files({ mime: "text/plain" }), "/tmp/file.txt")).toBeUndefined()
    expect(
      await readLocalAttachmentWith(
        {
          ...files({ mime: "image/png" }),
          readBytes: async () => Promise.reject(new Error("missing")),
        },
        "/tmp/missing.png",
      ),
    ).toBeUndefined()
  })
})

import { describe, expect, test } from "bun:test"
import { Office } from "@opencode-ai/core/office"
import { docxBytes, zipBytes } from "./lib/office"

// ponytail: .doc/.xls/.ods rely on the same parser code paths as the docx/xlsx
// checks below; swap for user-supplied real legacy files when they arrive.

const mime = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  odp: "application/vnd.oasis.opendocument.presentation",
  ppt: "application/vnd.ms-powerpoint",
} as const

describe("office extraction", () => {
  test("docx body extracts to markdown text", async () => {
    const extracted = await Office.extractOfficeText(await docxBytes("Hello from docx &amp; friends"), mime.docx)
    expect(extracted?.text).toContain("Hello from docx & friends")
    expect(extracted?.truncated).toBe(false)
  })

  test("xlsx spreadsheets extract per-sheet csv text", async () => {
    const XLSX = await import("xlsx")
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ["Region", "Revenue"],
        ["EMEA", "1200"],
      ]),
      "Summary",
    )
    const bytes = new Uint8Array(XLSX.write(book, { bookType: "xlsx", type: "array" }))
    const extracted = await Office.extractOfficeText(bytes, mime.xlsx)
    expect(extracted?.text).toContain("## Summary")
    expect(extracted?.text).toContain("EMEA")
    expect(extracted?.text).toContain("1200")
  })

  test("pptx slide text runs extract per slide", async () => {
    const slide = (text: string) =>
      `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>` +
      `<p:sp><p:txBody><a:p><a:r><a:t>${text} one</a:t></a:r></a:p>` +
      `<a:p><a:r><a:t>${text} two</a:t></a:r></a:p></p:txBody></p:sp>` +
      `</p:spTree></p:cSld></p:sld>`
    const bytes = await zipBytes({ "ppt/slides/slide2.xml": slide("Second"), "ppt/slides/slide1.xml": slide("First") })
    const text = (await Office.extractOfficeText(bytes, mime.pptx))?.text ?? ""
    expect(text).toContain("## Slide 1")
    expect(text.indexOf("First")).toBeLessThan(text.indexOf("Second"))
    expect(text).toContain("First one\nFirst two")
  })

  test("odt text paragraphs extract from content.xml", async () => {
    const bytes = await zipBytes({
      mimetype: "application/vnd.oasis.opendocument.text",
      "content.xml":
        `<?xml version="1.0"?><office:document-content><office:body><office:text>` +
        `<text:p>Hello &amp; welcome</text:p><text:h text:outline-level="1">Heading</text:h>` +
        `</office:text></office:body></office:document-content>`,
    })
    const extracted = await Office.extractOfficeText(bytes, mime.odt)
    expect(extracted?.text).toContain("Hello & welcome")
    expect(extracted?.text).toContain("Heading")
  })

  test("odp slide paragraphs extract with page names", async () => {
    const bytes = await zipBytes({
      mimetype: "application/vnd.oasis.opendocument.presentation",
      "content.xml":
        `<?xml version="1.0"?><office:document-content><office:body><office:presentation>` +
        `<draw:page draw:name="Cover"><draw:frame><text:p>Opening line</text:p></draw:frame></draw:page>` +
        `<draw:page draw:name="Numbers"><draw:frame><text:p>Big numbers</text:p></draw:frame></draw:page>` +
        `</office:presentation></office:body></office:document-content>`,
    })
    const extracted = await Office.extractOfficeText(bytes, mime.odp)
    expect(extracted?.text).toContain("## Cover")
    expect(extracted?.text).toContain("Opening line")
    expect(extracted?.text).toContain("## Numbers")
  })

  test("legacy ppt has no extractor and yields no text", async () => {
    expect(await Office.extractOfficeText(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), mime.ppt)).toBeUndefined()
  })

  test("oversized files yield no text", async () => {
    expect(await Office.extractOfficeText(new Uint8Array(Office.MAX_OFFICE_BYTES + 1), mime.docx)).toBeUndefined()
    expect(Office.extractionStub("a.docx")).toContain("a.docx")
    expect(Office.oversizeStub(undefined)).toContain("10 MiB")
  })

  test("extraction is truncated at the text cap", async () => {
    const long = "x".repeat(2000)
    const XLSX = await import("xlsx")
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(Array.from({ length: 60 }, () => [long])), "Big")
    const bytes = new Uint8Array(XLSX.write(book, { bookType: "xlsx", type: "array" }))
    const extracted = await Office.extractOfficeText(bytes, mime.xlsx)
    expect(extracted?.truncated).toBe(true)
    expect(extracted?.text).toContain("[truncated at 50 KB]")
  })

  test("data url extraction covers stubs and passes non-data uris through", async () => {
    const uri = `data:${mime.docx};base64,${Buffer.from(await docxBytes("Data url text")).toString("base64")}`
    expect(await Office.officeTextFromUri(uri, mime.docx, "a.docx")).toContain("Data url text")
    expect(await Office.officeTextFromUri("https://example.com/a.docx", mime.docx, "a.docx")).toBeUndefined()
    const junk = `data:${mime.docx};base64,${Buffer.from("not a docx").toString("base64")}`
    expect(await Office.officeTextFromUri(junk, mime.docx, "a.docx")).toBe(
      "[attachment a.docx: text could not be extracted]",
    )
    // 16 MiB of base64 estimates above the 10 MiB decoded cap.
    const huge = `data:${mime.docx};base64,${"A".repeat(16 * 1024 * 1024)}`
    expect(await Office.officeTextFromUri(huge, mime.docx, undefined)).toContain("10 MiB")
  })

  test("mime helpers cover all accepted office formats", () => {
    expect(Office.OFFICE_MIME_EXTENSIONS.size).toBe(9)
    expect(Office.officeMime(mime.docx)).toBe(mime.docx)
    expect(Office.officeMime("IMAGE/PNG")).toBeUndefined()
    expect(Office.officeMimeForFile("/tmp/a.DOCX")).toBe(mime.docx)
    expect(Office.officeMimeForFile("/tmp/a.txt")).toBeUndefined()
  })
})

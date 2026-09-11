/// <reference path="./word-extractor.d.ts" />

export * as Office from "./office"

import path from "path"

// Attachments and reads must stay cheap for the model: cap raw file bytes
// before parsing and cap extracted text before it enters context.
export const MAX_OFFICE_BYTES = 10 * 1024 * 1024
export const MAX_EXTRACTED_BYTES = 50 * 1024
export const MAX_OFFICE_BYTES_LABEL = "10 MiB"
export const MAX_EXTRACTED_BYTES_LABEL = "50 KB"

export const OFFICE_MIME_EXTENSIONS = new Map<string, string>([
  ["application/msword", "doc"],
  ["application/vnd.ms-excel", "xls"],
  ["application/vnd.ms-powerpoint", "ppt"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx"],
  ["application/vnd.oasis.opendocument.text", "odt"],
  ["application/vnd.oasis.opendocument.spreadsheet", "ods"],
  ["application/vnd.oasis.opendocument.presentation", "odp"],
])
const EXTENSION_MIMES = new Map(Array.from(OFFICE_MIME_EXTENSIONS, ([mime, ext]) => [ext, mime]))

// Bedrock Converse document blocks take these office bytes natively (mirrors
// packages/llm/src/protocols/utils/bedrock-media.ts DOCUMENT_FORMATS); every
// other provider receives extracted text instead.
export const NATIVE_OFFICE_DOCUMENT_MIMES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
])

export function officeMime(mime: string | undefined) {
  const lowered = mime?.toLowerCase()
  return lowered && OFFICE_MIME_EXTENSIONS.has(lowered) ? lowered : undefined
}

export function officeMimeForFile(filepath: string) {
  return EXTENSION_MIMES.get(path.extname(filepath).toLowerCase().slice(1))
}

export interface Extracted {
  text: string
  truncated: boolean
}

export function extractionStub(filename: string | undefined) {
  return `[attachment ${filename || "file"}: text could not be extracted]`
}

export function oversizeStub(filename: string | undefined) {
  return `[attachment ${filename || "file"}: file exceeds the ${MAX_OFFICE_BYTES_LABEL} office extraction limit]`
}

export async function extractOfficeText(bytes: Uint8Array, mime: string): Promise<Extracted | undefined> {
  const kind = OFFICE_MIME_EXTENSIONS.get(mime.toLowerCase())
  // ponytail: legacy binary decks have no maintained parser; scan PowerPoint
  // Document text atoms once a real .ppt use case shows up.
  if (!kind || kind === "ppt" || bytes.length > MAX_OFFICE_BYTES) return undefined
  try {
    const text = (await extractByKind(bytes, kind))?.trim()
    if (!text) return undefined
    return truncateExtracted(text)
  } catch {
    // A parse failure is indistinguishable from an unreadable document; the
    // caller surfaces a model-facing stub instead.
    return undefined
  }
}

// Extracts office text from a base64 data URL, falling back to model-facing
// stubs. Undefined means "not a base64 data URL" — the caller keeps whatever
// pass-through behavior it had for managed/remote URIs.
export async function officeTextFromUri(
  uri: string,
  mime: string,
  filename: string | undefined,
): Promise<string | undefined> {
  const comma = uri.indexOf(",")
  if (!uri.startsWith("data:") || comma === -1 || !uri.slice(0, comma).includes(";base64")) return undefined
  // Estimate the decoded size from the base64 length: oversized attachments
  // are history residents and must not be re-decoded on every provider turn.
  if (Math.floor(((uri.length - comma - 1) / 4) * 3) > MAX_OFFICE_BYTES) return oversizeStub(filename)
  const extracted = await extractOfficeText(Buffer.from(uri.slice(comma + 1), "base64"), mime)
  return extracted?.text ?? extractionStub(filename)
}

async function extractByKind(bytes: Uint8Array, kind: string): Promise<string | undefined> {
  switch (kind) {
    case "docx": {
      // mammoth exposes convertToMarkdown at runtime but omits it from its d.ts,
      // and resolves `value` to the markdown string itself.
      const mammoth = (await import("mammoth")) as unknown as {
        convertToMarkdown(input: { buffer: ArrayBuffer }): Promise<{ value: string }>
      }
      return (await mammoth.convertToMarkdown({ buffer: toArrayBuffer(bytes) })).value
    }
    case "doc": {
      const { default: WordExtractor } = await import("word-extractor")
      const doc = await new WordExtractor().extract(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
      return [doc.getBody(), doc.getFootnotes(), doc.getHeaders()].filter((part) => part.trim()).join("\n\n")
    }
    case "xls":
    case "xlsx":
    case "ods": {
      const XLSX = await import("xlsx")
      const book = XLSX.read(toArrayBuffer(bytes), { type: "array" })
      return book.SheetNames.map((name) => `## ${name}\n${XLSX.utils.sheet_to_csv(book.Sheets[name])}`).join("\n\n")
    }
    case "pptx":
      return extractSlides(bytes)
    case "odt":
    case "odp":
      return extractOpenDocument(bytes, kind)
  }
  return undefined
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function truncateExtracted(text: string): Extracted {
  if (Buffer.byteLength(text) <= MAX_EXTRACTED_BYTES) return { text, truncated: false }
  const cut = Buffer.from(text).subarray(0, MAX_EXTRACTED_BYTES).toString("utf8")
  return { text: `${cut}\n[truncated at ${MAX_EXTRACTED_BYTES_LABEL}]`, truncated: true }
}

async function readZipText(bytes: Uint8Array, accept: (name: string) => boolean) {
  const zip = await import("@zip.js/zip.js")
  const reader = new zip.ZipReader(new zip.Uint8ArrayReader(bytes))
  const out: { name: string; text: string }[] = []
  try {
    for (const entry of await reader.getEntries()) {
      if (entry.directory || !entry.getData || !accept(entry.filename)) continue
      out.push({
        name: entry.filename,
        text: await entry.getData(new zip.BlobWriter("text/xml")).then((b) => b.text()),
      })
    }
  } finally {
    await reader.close()
  }
  return out
}

// ponytail: naive OOXML slide extraction — text runs per paragraph, no layout,
// notes, or media. Replaces cleanly with a richer pptx parser if shape-order
// soup annoys models.
async function extractSlides(bytes: Uint8Array) {
  const slides = (await readZipText(bytes, (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))).sort(
    (a, b) => Number(a.name.match(/\d+/)?.[0] ?? 0) - Number(b.name.match(/\d+/)?.[0] ?? 0),
  )
  return slides
    .map((slide, index) => `## Slide ${index + 1}\n${xmlParagraphs(slide.text, "</a:p>", /<a:t>([\s\S]*?)<\/a:t>/g)}`)
    .filter((slide) => slide.split("\n").length > 1)
    .join("\n\n")
}

async function extractOpenDocument(bytes: Uint8Array, kind: string) {
  const [content] = await readZipText(bytes, (name) => name === "content.xml")
  if (!content) return ""
  if (kind !== "odp") return odfParagraphs(content.text)
  return content.text
    .split(/(?=<draw:page )/)
    .filter((page) => page.startsWith("<draw:page "))
    .map((page) => `## ${page.match(/draw:name="([^"]*)"/)?.[1] ?? "Slide"}\n${odfParagraphs(page)}`)
    .join("\n\n")
}

// ODF paragraphs hold prose directly (spans are inline); strip markup per paragraph.
function odfParagraphs(xml: string) {
  return xml
    .split(/<\/text:(?:p|h)>/)
    .map((chunk) => decodeXmlEntities(chunk.replace(/<[^>]*>/g, "")).trim())
    .filter(Boolean)
    .join("\n")
}

function xmlParagraphs(xml: string, paragraphEnd: string | RegExp, runs: RegExp) {
  return xml
    .split(paragraphEnd)
    .map((chunk) =>
      Array.from(chunk.matchAll(runs), (match) => decodeXmlEntities(match[1]))
        .join(" ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n")
}

function decodeXmlEntities(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

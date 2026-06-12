import { readFile } from "node:fs/promises"
import path from "node:path"
import { convertOfficeFile, DOCX_MIME, XLSX_MIME } from "./office-converter"

export type LocalFiles = Readonly<{
  readText(path: string): Promise<string>
  readBytes(path: string): Promise<Uint8Array>
  mime(path: string): Promise<string>
}>

export type LocalAttachment =
  | Readonly<{ type: "text"; mime: "image/svg+xml"; content: string }>
  | Readonly<{ type: "binary"; mime: string; content: Uint8Array }>
  | Readonly<{ type: "office"; mime: string; filename: string; content: string }>

export function readLocalAttachment(file: string) {
  return readLocalAttachmentWith(
    {
      readText: (value) => readFile(value, "utf8"),
      readBytes: (value) => readFile(value),
      mime: async (value) => mimeTypes[path.extname(value).toLowerCase()] ?? "application/octet-stream",
    },
    file,
  )
}

const mimeTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".docx": DOCX_MIME,
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".xlsx": XLSX_MIME,
}

export async function readLocalAttachmentWith(files: LocalFiles, filePath: string): Promise<LocalAttachment | undefined> {
  const mime = await files.mime(filePath).catch(() => undefined)
  if (!mime) return
  if (mime === "image/svg+xml") {
    const content = await files.readText(filePath).catch(() => undefined)
    if (!content) return
    return { type: "text", mime, content }
  }
  if (mime === DOCX_MIME || mime === XLSX_MIME) {
    const bytes = await files.readBytes(filePath).catch(() => undefined)
    if (!bytes) return
    const content = await convertOfficeFile(bytes, mime)
    if (!content) return
    const filename = path.basename(filePath)
    return { type: "office", mime, filename, content }
  }
  if (!mime.startsWith("image/") && mime !== "application/pdf") return
  const content = await files.readBytes(filePath).catch(() => undefined)
  if (!content) return
  return { type: "binary", mime, content }
}

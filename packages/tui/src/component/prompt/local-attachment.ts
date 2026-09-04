import path from "node:path"

// Bound filesystem work per terminal paste; the byte budget also bounds staged data.
const MAX_PASTED_FILEPATHS = 32
export const MAX_LOCAL_ATTACHMENT_BYTES = 20 * 1024 * 1024

export type LocalFiles = Readonly<{
  readText(path: string, maxBytes: number): Promise<string>
  readBytes(path: string, maxBytes: number): Promise<Uint8Array>
  mime(path: string): Promise<string>
}>

export type LocalAttachment =
  | Readonly<{ type: "text"; mime: "image/svg+xml"; content: string }>
  | Readonly<{ type: "binary"; mime: string; content: Uint8Array }>

export function readLocalAttachment(file: string, maxBytes = MAX_LOCAL_ATTACHMENT_BYTES) {
  return readLocalAttachmentWith(
    {
      readText: async (value, limit) => (await readFileBounded(value, limit)).toString("utf8"),
      readBytes: readFileBounded,
      mime: async (value) => mimeTypes[path.extname(value).toLowerCase()] ?? "application/octet-stream",
    },
    file,
    maxBytes,
  )
}

export async function resolvePastedAttachments(text: string, platform: string) {
  const pastedContent = text.trim()
  const filepath = normalizePastedFilepath(pastedContent, platform)
  if (/^(https?):\/\//.test(filepath)) return undefined

  const attachment = await readLocalAttachment(filepath)
  const attachments = attachment ? [{ filepath, attachment }] : []
  if (!attachment) {
    const filepaths = parsePastedFilepaths(pastedContent, platform)
    if (filepaths.length <= 1) return undefined
    let remaining = MAX_LOCAL_ATTACHMENT_BYTES
    for (const candidate of filepaths) {
      const next = await readLocalAttachment(candidate, remaining)
      if (!next) return undefined
      remaining -= typeof next.content === "string" ? Buffer.byteLength(next.content) : next.content.byteLength
      attachments.push({ filepath: candidate, attachment: next })
    }
  }

  return attachments.map((item) => {
    const filename = path.basename(item.filepath)
    if (item.attachment.type === "text") {
      return { type: "text" as const, content: item.attachment.content, filename }
    }
    return {
      type: "file" as const,
      uri: `data:${item.attachment.mime};base64,${Buffer.from(item.attachment.content).toString("base64")}`,
      filename: item.filepath,
    }
  })
}

const mimeTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
}

async function readFileBounded(file: string, maxBytes: number) {
  const source = Bun.file(file)
  if (!(await source.exists())) throw new Error("Attachment does not exist")
  if (source.size > maxBytes) throw new Error("Attachment exceeds the local file limit")
  const content = Buffer.from(await source.slice(0, maxBytes + 1).arrayBuffer())
  if (content.byteLength > maxBytes) throw new Error("Attachment exceeds the local file limit")
  return content
}

export function normalizePastedFilepath(value: string, platform: string) {
  const raw = value.replace(/^['"]+|['"]+$/g, "")
  const url = decodeFileURL(raw, platform)
  if (url) return url
  if (platform === "win32") return raw
  return raw.replace(/\\(.)/g, "$1")
}

function decodeFileURL(value: string, platform: string): string | undefined {
  if (!value.startsWith("file://")) return undefined
  try {
    const url = new URL(value)
    if (/%2f|%5c/i.test(url.pathname)) return undefined
    const pathname = decodeURIComponent(url.pathname)
    if (platform !== "win32") {
      if (url.hostname && url.hostname !== "localhost") return undefined
      return pathname
    }
    const local = pathname.replace(/^\/([A-Za-z]:)/, "$1").replaceAll("/", "\\")
    if (url.hostname && url.hostname !== "localhost") return `\\\\${url.hostname}${local}`
    return local
  } catch {
    return undefined
  }
}

export function parsePastedFilepaths(value: string, platform: string) {
  const result: string[] = []
  let current = ""
  let quote = ""

  function push() {
    if (!current) return
    result.push(decodeFileURL(current, platform) ?? current)
    current = ""
  }

  const input = value.includes("file://")
    ? value
        .split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith("#"))
        .join("\n")
    : value
  for (let index = 0; index < input.length; index++) {
    const character = input[index]
    if (quote) {
      if (character === quote) {
        quote = ""
        continue
      }
      if (character === "\\" && platform !== "win32" && quote === '"' && index + 1 < input.length) {
        current += input[++index]
        continue
      }
      current += character
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (character === "\\" && platform !== "win32" && index + 1 < input.length) {
      current += input[++index]
      continue
    }
    if (/\s/.test(character)) {
      push()
      if (result.length > MAX_PASTED_FILEPATHS) return []
      continue
    }
    current += character
  }

  if (quote) return []
  push()
  if (result.length > MAX_PASTED_FILEPATHS) return []
  return result
}

export async function readLocalAttachmentWith(
  files: LocalFiles,
  path: string,
  maxBytes = MAX_LOCAL_ATTACHMENT_BYTES,
): Promise<LocalAttachment | undefined> {
  const mime = await files.mime(path).catch(() => undefined)
  if (!mime) return undefined
  if (!mime.startsWith("image/") && mime !== "application/pdf") return undefined
  if (mime === "image/svg+xml") {
    const content = await files.readText(path, maxBytes).catch(() => undefined)
    if (!content || Buffer.byteLength(content) > maxBytes) return undefined
    return { type: "text", mime, content }
  }
  const content = await files.readBytes(path, maxBytes).catch(() => undefined)
  if (!content || content.byteLength > maxBytes) return undefined
  return { type: "binary", mime, content }
}

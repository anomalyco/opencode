import { stat } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

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

/** `video` also accepts MP4, MOV, and M4V files, which `<video>` can play. */
export type LocalAttachmentOptions = Readonly<{ video?: boolean }>

export function readLocalAttachment(
  file: string,
  maxBytes = MAX_LOCAL_ATTACHMENT_BYTES,
  options: LocalAttachmentOptions = {},
) {
  return readLocalAttachmentWith(
    {
      readText: async (value, limit) => (await readFileBounded(value, limit)).toString("utf8"),
      readBytes: readFileBounded,
      mime: async (value) => mimeTypes[path.extname(value).toLowerCase()] ?? "application/octet-stream",
    },
    file,
    maxBytes,
    options,
  )
}

export async function resolvePastedAttachments(text: string, platform: string, options: LocalAttachmentOptions = {}) {
  return (await resolvePastedFiles(text, platform, options)).attachments
}

/**
 * {@link resolvePastedAttachments}, and with `video`, the pasted video that takes an otherwise attachable paste over
 * the shared byte budget, so its paste falls back to text.
 */
export async function resolvePastedFiles(text: string, platform: string, options: LocalAttachmentOptions = {}) {
  const pastedContent = text.trim()
  const filepath = normalizePastedFilepath(pastedContent, platform)
  if (/^(https?):\/\//.test(filepath)) return {}

  const attachment = await readLocalAttachment(filepath, MAX_LOCAL_ATTACHMENT_BYTES, options)
  const attachments = attachment ? [{ filepath, attachment }] : []
  if (!attachment) {
    if (options.video && (await oversizedVideo(filepath, MAX_LOCAL_ATTACHMENT_BYTES))) return { oversized: filepath }
    const filepaths = parsePastedFilepaths(pastedContent, platform)
    if (filepaths.length <= 1) return {}
    let remaining = MAX_LOCAL_ATTACHMENT_BYTES
    for (const [index, candidate] of filepaths.entries()) {
      const next = await readLocalAttachment(candidate, remaining, options)
      if (!next) {
        if (!options.video || !(await oversizedVideo(candidate, remaining))) return {}
        const rest = await Promise.all(filepaths.slice(index + 1).map(attachable))
        return rest.every(Boolean) ? { oversized: candidate } : {}
      }
      remaining -= typeof next.content === "string" ? Buffer.byteLength(next.content) : next.content.byteLength
      attachments.push({ filepath: candidate, attachment: next })
    }
  }

  return {
    attachments: attachments.map((item) => {
      const filename = path.basename(item.filepath)
      if (item.attachment.type === "text") {
        return { type: "text" as const, content: item.attachment.content, filename }
      }
      return {
        type: "file" as const,
        uri: `data:${item.attachment.mime};base64,${Buffer.from(item.attachment.content).toString("base64")}`,
        filename,
        path: path.resolve(item.filepath),
      }
    }),
  }
}

async function oversizedVideo(file: string, budget: number) {
  if (!mimeTypes[path.extname(file).toLowerCase()]?.startsWith("video/")) return false
  const info = await stat(file).catch(() => undefined)
  return info?.isFile() === true && info.size > budget
}

// An existing file of a type a paste can attach, whatever its size.
async function attachable(file: string) {
  if (!mimeTypes[path.extname(file).toLowerCase()]) return false
  const info = await stat(file).catch(() => undefined)
  return info?.isFile() === true
}

/**
 * The files of a prompt to send, with each attachment history or the stash kept as its local file (a `file://` uri and
 * a `path`) read again. `unreadable` names the files that no longer exist or are over the limit; they are left out.
 */
export async function readKeptAttachments<T extends { uri: string; path?: string }>(files: readonly T[]) {
  const read = await Promise.all(
    files.map(async (file) => {
      if (!file.path || !file.uri.startsWith("file:")) return file
      const attachment = await readLocalAttachment(file.path, MAX_LOCAL_ATTACHMENT_BYTES, { video: true })
      if (attachment?.type !== "binary") return path.basename(file.path)
      return { ...file, uri: `data:${attachment.mime};base64,${Buffer.from(attachment.content).toString("base64")}` }
    }),
  )
  return {
    files: read.filter((file) => typeof file !== "string"),
    unreadable: read.filter((file) => typeof file === "string"),
  }
}

/** The file extension for an attachment mime type, such as `.mov` for `video/quicktime`. */
export function attachmentExtension(mime: string) {
  return Object.keys(mimeTypes).find((extension) => mimeTypes[extension] === mime)
}

// Keep the captured bytes: a local server may not have the terminal's access to the source file.
export function promptFilesForServer<T extends { uri: string; path?: string }>(
  files: readonly T[] | undefined,
  localServer: boolean,
) {
  return files?.map(({ path: file, ...rest }) =>
    file && localServer ? { ...rest, source: { type: "uri" as const, uri: pathToFileURL(file).href } } : rest,
  )
}

const mimeTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
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
  options: LocalAttachmentOptions = {},
): Promise<LocalAttachment | undefined> {
  const mime = await files.mime(path).catch(() => undefined)
  if (!mime) return undefined
  if (!mime.startsWith("image/") && mime !== "application/pdf" && !(options.video && mime.startsWith("video/")))
    return undefined
  if (mime === "image/svg+xml") {
    const content = await files.readText(path, maxBytes).catch(() => undefined)
    if (!content || Buffer.byteLength(content) > maxBytes) return undefined
    return { type: "text", mime, content }
  }
  const content = await files.readBytes(path, maxBytes).catch(() => undefined)
  if (!content || content.byteLength > maxBytes) return undefined
  return { type: "binary", mime, content }
}

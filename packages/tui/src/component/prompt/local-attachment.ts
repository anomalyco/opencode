import { stat } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

// Bound filesystem work per terminal paste; the byte budget also bounds staged data.
const MAX_PASTED_FILEPATHS = 32
export const MAX_LOCAL_ATTACHMENT_BYTES = 20 * 1024 * 1024
// Core sends a video only up to 18 MiB of base64 (VIDEO_BYTES_MAX in packages/core/src/session/model-request.ts), which
// is 13.5 MiB of file. A larger clip would be attached and stored, then dropped on the first model turn.
export const MAX_LOCAL_VIDEO_BYTES = (18 * 1024 * 1024 * 3) / 4

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

export async function resolvePastedAttachments(text: string, platform: string, video = false) {
  const pastedContent = text.trim()
  const filepath = normalizePastedFilepath(pastedContent, platform)
  if (/^(https?):\/\//.test(filepath)) return undefined

  const attachment = await readPastedAttachment(filepath, MAX_LOCAL_ATTACHMENT_BYTES, video)
  const attachments = attachment ? [{ filepath, attachment }] : []
  if (!attachment) {
    const filepaths = parsePastedFilepaths(pastedContent, platform)
    if (filepaths.length <= 1) return undefined
    let remaining = MAX_LOCAL_ATTACHMENT_BYTES
    for (const candidate of filepaths) {
      const next = await readPastedAttachment(candidate, remaining, video)
      if (!next) return undefined
      remaining -=
        next.type === "video"
          ? next.size
          : typeof next.content === "string"
            ? Buffer.byteLength(next.content)
            : next.content.byteLength
      attachments.push({ filepath: candidate, attachment: next })
    }
  }

  return attachments.map((item) => {
    const filename = path.basename(item.filepath)
    if (item.attachment.type === "text") {
      return { type: "text" as const, content: item.attachment.content, filename }
    }
    const file = path.resolve(item.filepath)
    return {
      type: "file" as const,
      uri:
        item.attachment.type === "video"
          ? pathToFileURL(file).href
          : `data:${item.attachment.mime};base64,${Buffer.from(item.attachment.content).toString("base64")}`,
      filename,
      path: file,
    }
  })
}

// A video stays a path, read when the prompt is sent, so pasting one does not stall typing while it is encoded.
async function readPastedAttachment(file: string, maxBytes: number, video: boolean) {
  const mime = mimeTypes[path.extname(file).toLowerCase()]
  if (!video || !mime?.startsWith("video/")) return readLocalAttachment(file, maxBytes)
  const info = await stat(file).catch(() => undefined)
  if (!info?.isFile() || info.size > Math.min(maxBytes, MAX_LOCAL_VIDEO_BYTES)) return undefined
  return { type: "video" as const, size: info.size }
}

/** The video that takes a paste of otherwise attachable files over the attachment limit, so the paste stays text. */
export async function oversizedPastedVideo(text: string, platform: string) {
  const pasted = text.trim()
  for (const files of [[normalizePastedFilepath(pasted, platform)], parsePastedFilepaths(pasted, platform)]) {
    const sizes = await Promise.all(
      files.map(async (file) => {
        if (!mimeTypes[path.extname(file).toLowerCase()]) return undefined
        const info = await stat(file).catch(() => undefined)
        return info?.isFile() ? info.size : undefined
      }),
    )
    if (files.length === 0 || sizes.includes(undefined)) continue
    const isVideo = (file: string) => mimeTypes[path.extname(file).toLowerCase()]!.startsWith("video/")
    let total = 0
    const file = files.find(
      (file, index) =>
        (total += sizes[index]!) > MAX_LOCAL_ATTACHMENT_BYTES ||
        (isVideo(file) && sizes[index]! > MAX_LOCAL_VIDEO_BYTES),
    )
    return file && isVideo(file) ? file : undefined
  }
}

// Reads again the videos a draft, history, or the stash kept as local paths. `unreadable` names the ones left out.
export async function readKeptAttachments<T extends { uri: string; path?: string }>(files: readonly T[]) {
  const read = await Promise.all(
    files.map(async (file) => {
      if (!file.path || !file.uri.startsWith("file:")) return file
      const content = await readFileBounded(file.path, MAX_LOCAL_VIDEO_BYTES).catch(() => undefined)
      if (!content) return path.basename(file.path)
      return { ...file, uri: `data:${keptVideoMime(file.path)};base64,${content.toString("base64")}` }
    }),
  )
  return {
    files: read.filter((file) => typeof file !== "string"),
    unreadable: read.filter((file) => typeof file === "string"),
  }
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

/** The extension history and the stash name a kept video's file with; `keptVideoMime` reads the type back from it. */
export function keptVideoExtension(mime: string) {
  const type = mime.toLowerCase()
  return (
    Object.keys(mimeTypes).find((key) => mimeTypes[key] === type) ??
    `.${type.slice("video/".length).replace(/[^\w+-]/g, "")}`
  )
}

function keptVideoMime(file: string) {
  const extension = path.extname(file).toLowerCase()
  return mimeTypes[extension] ?? `video/${extension.slice(1)}`
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

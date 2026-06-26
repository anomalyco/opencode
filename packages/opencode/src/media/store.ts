import path from "path"
import { createHash } from "crypto"
import { mkdir } from "fs/promises"
import { Global } from "@opencode-ai/core/global"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { isMedia } from "@/util/media"
import { DataUrl } from "./data-url"

const SCHEME = "media://"

type Attachment = {
  readonly mime: string
  readonly url: string
  readonly filename?: string
}

type Metadata = {
  readonly id: string
  readonly sha256: string
  readonly mime: string
  readonly bytes: number
  readonly filename?: string
  readonly createdAt: number
}

export function isRef(url: string) {
  return url.startsWith(SCHEME)
}

export function mediaKind(mime: string) {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("video/")) return "video"
  if (mime.startsWith("audio/")) return "audio"
  if (mime === "application/pdf") return "pdf"
  return "file"
}

export async function archiveAttachment<T extends Attachment>(attachment: T): Promise<T> {
  if (!isMedia(attachment.mime) || isRef(attachment.url)) return attachment
  const parsed = DataUrl.parse(attachment.url)
  if (!parsed) return attachment
  const sha256 = createHash("sha256").update(parsed.data).digest("hex")
  const id = `med_${sha256.slice(0, 32)}`
  await mkdir(path.join(Global.Path.data, "media", "blobs"), { recursive: true })
  await mkdir(path.join(Global.Path.data, "media", "meta"), { recursive: true })
  await Bun.write(path.join(Global.Path.data, "media", "blobs", sha256), parsed.data)
  await Bun.write(
    path.join(Global.Path.data, "media", "meta", `${id}.json`),
    JSON.stringify(
      {
        id,
        sha256,
        mime: attachment.mime || parsed.mime,
        bytes: parsed.data.byteLength,
        filename: attachment.filename,
        createdAt: Date.now(),
      } satisfies Metadata,
      null,
      2,
    ),
  )
  return {
    ...attachment,
    url: `${SCHEME}${id}`,
  }
}

export async function archiveAttachments<T extends Attachment>(
  attachments: readonly T[] | undefined,
): Promise<T[] | undefined> {
  if (!attachments) return undefined
  return Promise.all(attachments.map(archiveAttachment))
}

export async function resolveAttachment<T extends Attachment>(attachment: T): Promise<T> {
  if (!isRef(attachment.url)) return attachment
  const metadata = await readMetadata(attachment.url)
  if (!metadata) return attachment
  return {
    ...attachment,
    mime: attachment.mime || metadata.mime,
    filename: attachment.filename ?? metadata.filename,
    url: DataUrl.format({
      mime: attachment.mime || metadata.mime,
      data: await Bun.file(path.join(Global.Path.data, "media", "blobs", metadata.sha256)).bytes(),
    }),
  }
}

export async function placeholder(attachment: Attachment) {
  const metadata = isRef(attachment.url) ? await readMetadata(attachment.url) : undefined
  const mime = attachment.mime || metadata?.mime || "media"
  const filename = attachment.filename ?? metadata?.filename ?? "file"
  const size = metadata ? `, ${metadata.bytes} bytes` : ""
  return `[Previously attached ${mediaKind(mime)}: ${filename}, ${mime}${size}]`
}

export function placeholderUrl(attachment: Attachment): string {
  const mime = attachment.mime || "media"
  const filename = attachment.filename ?? "file"
  const sizeHint = attachment.url.startsWith("data:") ? `, ~${Buffer.byteLength(attachment.url, "utf8")} bytes` : ""
  return `[Attached ${mediaKind(mime)} too large to inline: ${filename}, ${mime}${sizeHint}]`
}

async function readMetadata(url: string): Promise<Metadata | undefined> {
  const id = url.slice(SCHEME.length)
  if (!id) return undefined
  const file = Bun.file(path.join(Global.Path.data, "media", "meta", `${id}.json`))
  if (!(await file.exists())) return undefined
  return file.json()
}

export * as MediaStore from "./store"

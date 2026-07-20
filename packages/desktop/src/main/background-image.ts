import { randomUUID } from "node:crypto"
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"
import { MAX_ATTACHMENT_BYTES, readBoundedFile } from "./attachment-picker"

const name = "background-image"
const mime = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
} as const

export const backgroundImageExtensions = Object.keys(mime).map((extension) => extension.slice(1))

export async function findBackgroundImage(directory: string) {
  const candidates = await Promise.all(
    Object.entries(mime).map(async ([extension, contentType]) => {
      const path = join(directory, `${name}${extension}`)
      const info = await stat(path).catch(() => undefined)
      if (!info?.isFile() || info.size > MAX_ATTACHMENT_BYTES) return
      return { path, mime: contentType, revision: `${info.mtimeMs}-${info.size}`, modified: info.mtimeMs }
    }),
  )
  return candidates.filter((candidate) => candidate !== undefined).sort((a, b) => b.modified - a.modified)[0]
}

export async function saveBackgroundImage(directory: string, path: string) {
  const extension = extname(path).toLowerCase() as keyof typeof mime
  if (!mime[extension]) throw new Error("Unsupported background image format")
  const data = await readBoundedFile(path, MAX_ATTACHMENT_BYTES, "Background images must be 20 MB or smaller")
  await mkdir(directory, { recursive: true })
  const target = join(directory, `${name}${extension}`)
  const temporary = join(directory, `.${name}-${randomUUID()}`)
  await writeFile(temporary, new Uint8Array(data))
  await rename(temporary, target).finally(() => rm(temporary, { force: true }))
  await Promise.all(
    Object.keys(mime)
      .filter((candidate) => candidate !== extension)
      .map((candidate) => rm(join(directory, `${name}${candidate}`), { force: true })),
  )
  return findBackgroundImage(directory)
}

export async function clearBackgroundImage(directory: string) {
  await Promise.all(Object.keys(mime).map((extension) => rm(join(directory, `${name}${extension}`), { force: true })))
}

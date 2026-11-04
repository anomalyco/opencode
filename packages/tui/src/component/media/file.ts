import { mediaHashFromUri, type LocationRef } from "@opencode/client"
import { mkdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { mediaMime, type MediaItem } from "./model"

type MediaFiles = ReturnType<typeof createMediaFiles>

const VIDEO_EXTENSIONS: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/x-m4v": ".m4v",
}

/**
 * Content-addressed files under `directory`, named `<sha256><extension>`. Each is written once to a temporary name and
 * renamed into place, so a reader never opens a partial file; concurrent writes of the same content share one write.
 */
export function createMediaFiles(directory: string) {
  const inflight = new Map<string, Promise<string>>()

  function ensure(hash: string, extension: string, bytes: () => Promise<Uint8Array>) {
    const file = path.join(directory, hash + extension)
    const pending =
      inflight.get(file) ??
      Bun.file(file)
        .exists()
        .then(async (exists) => {
          if (exists) return file
          const content = await bytes()
          const temporary = `${file}.${crypto.randomUUID()}.tmp`
          await mkdir(directory, { recursive: true })
          await Bun.write(temporary, content)
          await rename(temporary, file).catch(async (error) => {
            await rm(temporary, { force: true })
            throw error
          })
          return file
        })
        .finally(() => inflight.delete(file))
    inflight.set(file, pending)
    return pending
  }

  return {
    ensure,
    write: (bytes: Uint8Array, extension: string) =>
      ensure(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), extension, () => Promise.resolve(bytes)),
  }
}

export type MediaSources = Readonly<{
  files: MediaFiles
  /** The server runs on this machine, so `file://` uris name local files. */
  localServer: boolean
  media?: Readonly<{ read: (uri: string) => Promise<Uint8Array> }>
  readFile?: (input: { path: string; location: LocationRef }) => Promise<Uint8Array>
}>

/**
 * A local path `<video>` can open: the item's own file when this machine can read it, otherwise its bytes copied
 * into the media files. Rejects when nothing can supply the bytes.
 */
export async function resolveVideoFile(item: MediaItem, sources: MediaSources) {
  const local = await localFile(item, sources.localServer)
  if (local) return local
  const extension =
    VIDEO_EXTENSIONS[item.mime.toLowerCase()] ??
    VIDEO_EXTENSIONS[mediaMime(item.path ?? item.name ?? "") ?? ""] ??
    ".mp4"
  const hash = mediaHashFromUri(item.uri)
  if (hash) {
    const media = sources.media
    if (!media) throw new Error(`No client to read ${item.uri}`)
    return sources.files.ensure(hash, extension, () => media.read(item.uri))
  }
  if (item.uri.startsWith("data:")) return sources.files.write(decodeDataUri(item.uri), extension)
  return sources.files.write(await readServerFile(item, sources), extension)
}

/**
 * What `<image>` can load for the item: its own file when this machine can read it, a data URI, or the bytes of a
 * media ref or server file. Rejects other URLs, which `<image>` would fetch or read on this machine.
 */
export async function resolveImageSource(item: MediaItem, sources: MediaSources): Promise<string | Uint8Array> {
  const local = await localFile(item, sources.localServer)
  if (local) return local
  if (item.uri.startsWith("data:")) return item.uri
  if (!mediaHashFromUri(item.uri)) return readServerFile(item, sources)
  if (!sources.media) throw new Error(`No client to read ${item.uri}`)
  return sources.media.read(item.uri)
}

// A draft's path may be gone while its uri still holds the bytes.
async function localFile(item: MediaItem, localServer: boolean) {
  if (item.path && (await Bun.file(item.path).exists())) return item.path
  if (!localServer || !item.uri.startsWith("file:")) return undefined
  const file = fileURLToPath(item.uri)
  return (await Bun.file(file).exists()) ? file : undefined
}

// The server's paths follow its own OS, which need not be this machine's.
async function readServerFile(item: MediaItem, sources: MediaSources) {
  const url = URL.parse(item.uri)
  const location = item.location
  if (url?.protocol !== "file:" || (url.host !== "" && url.host !== "localhost") || !location || !sources.readFile)
    throw new Error(`Cannot read ${item.uri} from this terminal`)
  const pathname = decodeURIComponent(url.pathname)
  const file = /^\/[a-z]:\//i.test(pathname) ? pathname.slice(1) : pathname
  const flavor = /^(?:[a-z]:[\\/]|\\\\)/i.test(location.directory) ? path.win32 : path.posix
  const relative = flavor.relative(location.directory, file).replaceAll("\\", "/")
  if (!relative || relative === ".." || relative.startsWith("../") || flavor.isAbsolute(relative))
    throw new Error(`${item.uri} lies outside ${location.directory}`)
  return sources.readFile({ path: relative, location })
}

function decodeDataUri(uri: string) {
  const comma = uri.indexOf(",")
  if (!uri.slice(0, comma).endsWith(";base64")) throw new Error("Only base64 data URIs hold video")
  return Buffer.from(uri.slice(comma + 1), "base64")
}

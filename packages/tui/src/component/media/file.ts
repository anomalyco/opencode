import { mediaHashFromUri, type LocationRef } from "@opencode/client"
import { mkdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { MEDIA_EXTENSIONS, mediaMime, type MediaItem } from "./model"

/**
 * Content-addressed files under `directory`, named `<sha256><extension>`. Each is written once to a temporary name and
 * renamed into place, so a reader never opens a partial file; concurrent writes of the same file share one write.
 */
export function createMediaFiles(directory: string) {
  const inflight = new Map<string, Promise<string>>()

  function ensure(hash: string, extension: string, bytes: () => Promise<Uint8Array>) {
    const file = path.join(directory, hash + extension)
    const pending =
      inflight.get(file) ??
      (async () => {
        if (await Bun.file(file).exists()) return file
        const content = await bytes()
        const temporary = `${file}.${crypto.randomUUID()}.tmp`
        await mkdir(directory, { recursive: true })
        await Bun.write(temporary, content)
        await rename(temporary, file).catch((error) => rm(temporary, { force: true }).then(() => Promise.reject(error)))
        return file
      })().finally(() => inflight.delete(file))
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
  files: ReturnType<typeof createMediaFiles>
  /** The server runs on this machine, so `file://` uris name local files. */
  localServer: boolean
  media?: Readonly<{ read: (uri: string) => Promise<Uint8Array> }>
  readFile?: (input: { path: string; location: LocationRef }) => Promise<Uint8Array>
}>

/** A local path `<video>` can open: the item's own file, or its bytes copied into the media files. */
export async function resolveVideoFile(item: MediaItem, sources: MediaSources) {
  const local = await localFile(item, sources.localServer)
  if (local) return local
  const find = (mime?: string) => Object.keys(MEDIA_EXTENSIONS).find((key) => MEDIA_EXTENSIONS[key] === mime)
  const extension = find(item.mime.toLowerCase()) ?? find(mediaMime(item.path ?? item.name ?? "")) ?? ".mp4"
  const hash = mediaHashFromUri(item.uri)
  if (hash) return sources.files.ensure(hash, extension, () => readMedia(item, sources))
  if (!item.uri.startsWith("data:")) return sources.files.write(await readServerFile(item, sources), extension)
  const comma = item.uri.indexOf(",")
  if (!item.uri.slice(0, comma).endsWith(";base64")) throw new Error("Only base64 data URIs hold video")
  return sources.files.write(Buffer.from(item.uri.slice(comma + 1), "base64"), extension)
}

/**
 * What `<image>` can load: its own file, a data URI, or the bytes of a media ref or server file. Rejects other URLs,
 * which `<image>` would fetch or read on this machine.
 */
export async function resolveImageSource(item: MediaItem, sources: MediaSources): Promise<string | Uint8Array> {
  const local = await localFile(item, sources.localServer)
  if (local) return local
  if (item.uri.startsWith("data:")) return item.uri
  if (mediaHashFromUri(item.uri)) return readMedia(item, sources)
  return readServerFile(item, sources)
}

// A draft's path may be gone while its uri still holds the bytes.
async function localFile(item: MediaItem, localServer: boolean) {
  if (item.path && (await Bun.file(item.path).exists())) return item.path
  if (!localServer || !item.uri.startsWith("file:")) return undefined
  const file = fileURLToPath(item.uri)
  return (await Bun.file(file).exists()) ? file : undefined
}

function readMedia(item: MediaItem, sources: MediaSources) {
  if (!sources.media) throw new Error(`No client to read ${item.uri}`)
  return sources.media.read(item.uri)
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

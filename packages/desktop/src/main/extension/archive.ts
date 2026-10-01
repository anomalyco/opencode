import { TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js"
import { ExtensionError } from "./error"
import { archivePath, decodeManifest } from "./manifest"
import { mainImportAllowed } from "./module"

export const archiveLimit = 104_857_600
const entryLimit = 4_096

/** Reads and validates an extension archive before anything replaces a working installation. */
export async function readArchive(data: Uint8Array) {
  if (data.byteLength > archiveLimit) throw new ExtensionError("tooLarge")
  if (data[0] !== 0x50 || data[1] !== 0x4b) throw new ExtensionError("invalidArchive")
  // zip.js expects slice() to copy; Node Buffer.slice() returns a view instead.
  const reader = new ZipReader(new Uint8ArrayReader(Buffer.isBuffer(data) ? new Uint8Array(data) : data), {
    useWebWorkers: false,
  })
  return read(reader)
    .catch((error: unknown) => {
      if (error instanceof ExtensionError) throw error
      throw new ExtensionError("invalidArchive", { cause: error })
    })
    .finally(() => reader.close())
}

async function read(reader: ZipReader<Uint8Array>) {
  const entries = await reader.getEntries()
  if (entries.length > entryLimit || entries.reduce((total, entry) => total + entry.uncompressedSize, 0) > archiveLimit)
    throw new ExtensionError("tooLarge")
  const paths = entries.map((entry) =>
    archivePath(entry.directory ? entry.filename.replace(/\/$/, "") : entry.filename),
  )
  if (new Set(paths).size !== paths.length) throw new ExtensionError("invalidPath")
  const metadata = entries.find((entry) => entry.filename === "manifest.json" && !entry.directory)
  if (!metadata?.getData || metadata.uncompressedSize > 65_536) throw new ExtensionError("invalidManifest")
  const decoded = decodeManifest(await metadata.getData(new TextWriter()))
  if (decoded._tag === "None") throw new ExtensionError("invalidManifest")
  const manifest = decoded.value
  const entrypoints = [manifest.renderer, manifest.main, manifest.style].filter((path) => path !== undefined)
  entrypoints.forEach(archivePath)
  if (!(manifest.imports.main ?? []).every(mainImportAllowed)) throw new ExtensionError("invalidModule")
  const files = await Promise.all(
    entries
      .filter((entry) => !entry.directory)
      .map(async (entry) => {
        if (!entry.getData) throw new ExtensionError("invalidArchive")
        return { path: entry.filename, data: Buffer.from(await entry.getData(new Uint8ArrayWriter())) }
      }),
  )
  if (files.reduce((total, file) => total + file.data.byteLength, 0) > archiveLimit)
    throw new ExtensionError("tooLarge")
  if (!entrypoints.every((path) => files.some((file) => file.path === path)))
    throw new ExtensionError("invalidManifest")
  // Reject syntax errors before replacing a working installation; evaluation happens in the hosts.
  const broken = [manifest.renderer, manifest.main]
    .flatMap((path) => files.filter((file) => file.path === path))
    .find((file) => !compiles(file.data.toString("utf8")))
  if (broken) throw new ExtensionError("invalidModule", { message: broken.path })
  return { manifest, files }
}

function compiles(source: string) {
  // Compiling is the only syntax check the runtime offers, and it reports failure by throwing.
  try {
    new Function("require", "module", "exports", source)
    return true
  } catch {
    return false
  }
}

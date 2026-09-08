import { Uint8ArrayReader, Uint8ArrayWriter, TextWriter, ZipReader } from "@zip.js/zip.js"
import { Schema } from "effect"
import { createHash } from "node:crypto"
import { ExtensionManager } from "@opencode/plugin/desktop/manager"

export const archiveLimit = 1_073_741_824

export function archivePath(value: string) {
  if (
    !value ||
    value.includes("\\") ||
    value.includes(":") ||
    /[\u0000-\u001f]/.test(value) ||
    value.startsWith("/") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new ExtensionManager.ManagerError("invalidPath")
  }
  return value
}

export async function readArchive(data: Uint8Array) {
  if (data.byteLength > archiveLimit) throw new ExtensionManager.ManagerError("tooLarge")
  if (data[0] !== 0x50 || data[1] !== 0x4b) throw new ExtensionManager.ManagerError("invalidArchive")
  // zip.js expects slice() to copy; Node Buffer.slice() returns a view instead.
  const reader = new ZipReader(new Uint8ArrayReader(Buffer.isBuffer(data) ? new Uint8Array(data) : data), {
    useWebWorkers: false,
  })
  try {
    const entries = await reader.getEntries()
    if (entries.length > 1024 || entries.reduce((total, entry) => total + entry.uncompressedSize, 0) > archiveLimit)
      throw new ExtensionManager.ManagerError("tooLarge")
    const paths = entries.map((entry) =>
      archivePath(entry.directory ? entry.filename.replace(/\/$/, "") : entry.filename),
    )
    if (new Set(paths).size !== paths.length) throw new ExtensionManager.ManagerError("invalidPath")
    const metadata = entries.find((entry) => entry.filename === "manifest.json" && !entry.directory)
    if (!metadata || metadata.directory || !metadata.getData || metadata.uncompressedSize > 65536)
      throw new ExtensionManager.ManagerError("invalidManifest")
    const manifest = Schema.decodeUnknownOption(Schema.fromJsonString(ExtensionManager.Manifest))(
      await metadata.getData(new TextWriter()),
    )
    if (manifest._tag === "None") throw new ExtensionManager.ManagerError("invalidManifest")
    const value = manifest.value
    archivePath(value.entry)
    if (value.main) archivePath(value.main)
    if (value.style) archivePath(value.style)
    const files = await Promise.all(
      entries
        .filter((entry) => !entry.directory)
        .map(async (entry) => {
          if (!entry.getData) throw new ExtensionManager.ManagerError("invalidArchive")
          return { path: entry.filename, data: Buffer.from(await entry.getData(new Uint8ArrayWriter())) }
        }),
    )
    if (files.reduce((total, file) => total + file.data.byteLength, 0) > archiveLimit)
      throw new ExtensionManager.ManagerError("tooLarge")
    if (value.style && !files.some((file) => file.path === value.style))
      throw new ExtensionManager.ManagerError("invalidManifest")
    for (const entry of [value.entry, value.main].filter((entry) => entry !== undefined)) {
      const file = files.find((file) => file.path === entry)
      if (!file) throw new ExtensionManager.ManagerError("invalidManifest")
      // Reject syntax errors before replacing a working installation. Execution
      // remains in the renderer/main host with their shared module identities.
      try {
        new Function("require", "module", "exports", file.data.toString("utf8"))
      } catch {
        throw new ExtensionManager.ManagerError("invalidModule")
      }
    }
    return { manifest: value, revision: createHash("sha256").update(data).digest("hex"), files }
  } catch (error) {
    if (error instanceof ExtensionManager.ManagerError) throw error
    throw new ExtensionManager.ManagerError("invalidArchive", { cause: error })
  } finally {
    await reader.close()
  }
}

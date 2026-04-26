import path from "path"
import fs from "fs/promises"
import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js"

function destination(root: string, filename: string) {
  const normalized = filename.replace(/\\/g, "/")
  const target = path.resolve(root, normalized)
  const relative = path.relative(root, target)
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`zip entry escapes destination: ${filename}`)
  }
  return target
}

export async function extractZip(zipPath: string, destDir: string) {
  const root = path.resolve(destDir)
  const reader = new ZipReader(new BlobReader(Bun.file(zipPath)), { useWebWorkers: false })
  try {
    for (const entry of await reader.getEntries()) {
      const target = destination(root, entry.filename)
      if (entry.directory) {
        await fs.mkdir(target, { recursive: true })
        continue
      }
      if (!entry.getData) throw new Error(`zip entry cannot be extracted: ${entry.filename}`)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await Bun.write(target, await entry.getData(new Uint8ArrayWriter(), { useWebWorkers: false }))
      if (entry.executable && process.platform !== "win32") await fs.chmod(target, 0o755)
    }
  } finally {
    await reader.close()
  }
}

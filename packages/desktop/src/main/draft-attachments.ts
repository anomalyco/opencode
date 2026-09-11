import { randomUUID } from "node:crypto"
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"

export function createDraftAttachmentMaterializer(input: { directory: string; getBlob: (id: string) => Uint8Array | null }) {
  const materialized = new Map<string, string>()
  const cleanupExpired = async () => {
    const now = Date.now()
    const entries = await readdir(input.directory, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.startsWith("pasted-text-") && entry.name.endsWith(".txt"))
        .map(async (entry) => {
          const path = join(input.directory, entry.name)
          const metadata = await stat(path).catch(() => undefined)
          if (!metadata || now - metadata.mtimeMs < 24 * 60 * 60 * 1000) return
          await unlink(path).catch(() => undefined)
        }),
    )
  }
  const materialize = async (blobID: string) => {
    const data = input.getBlob(blobID)
    if (!data) throw new Error("Draft attachment was not found")
    await mkdir(input.directory, { recursive: true })
    await cleanupExpired()
    const id = randomUUID()
    const path = join(input.directory, `pasted-text-${id}.txt`)
    await writeFile(path, data, { flag: "wx" })
    materialized.set(id, path)
    return { id, path }
  }
  const cleanup = async (id: string) => {
    const path = materialized.get(id)
    if (!path) return
    materialized.delete(id)
    await unlink(path).catch(() => undefined)
  }
  return { materialize, cleanup }
}

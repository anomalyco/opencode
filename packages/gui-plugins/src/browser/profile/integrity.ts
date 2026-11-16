import { createHash } from "node:crypto"
import { lstat, open, opendir } from "node:fs/promises"
import path from "node:path"

/** SHA-256 of sorted (path, content hash) records. No mtime shortcut: editing a script need not change its size. */
export async function extensionDigest(root: string) {
  const records: string[] = []
  let count = 0
  let bytes = 0
  const chunk = Buffer.allocUnsafe(64 * 1024)

  const walk = async (folder: string, prefix: string, depth: number) => {
    if (depth > 64 || !(await lstat(folder)).isDirectory()) return false

    for await (const entry of await opendir(folder)) {
      if (++count > 10_000) return false
      const name = prefix + entry.name
      const target = path.join(folder, entry.name)

      if (entry.isDirectory()) {
        records.push(JSON.stringify([name]))

        if (!(await walk(target, name + "/", depth + 1))) return false
        continue
      }

      if (!entry.isFile()) return false
      const file = await open(target, "r")

      try {
        const info = await file.stat()

        if (!info.isFile() || info.size > 64 * 1024 * 1024 || bytes + info.size > 256 * 1024 * 1024) return false
        bytes += info.size
        const hash = createHash("sha256")

        for (let at = 0; at < info.size;) {
          const { bytesRead } = await file.read(chunk, 0, Math.min(info.size - at, chunk.length), at)

          if (!bytesRead) return false
          hash.update(chunk.subarray(0, bytesRead))
          at += bytesRead
        }

        if ((await file.stat()).size !== info.size) return false
        records.push(JSON.stringify([name, hash.digest("hex")]))
      } finally {
        await file.close()
      }
    }

    return true
  }

  return await walk(root, "", 0).catch(() => false) ? createHash("sha256").update(records.sort().join("\n")).digest("hex") : undefined
}

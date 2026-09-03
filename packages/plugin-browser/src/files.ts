export * as BrowserFiles from "./files.js"

import { Browser } from "@opencode-ai/schema/browser"

// Files cross machines as bytes. Only this endpoint interprets its local paths.
export async function read(paths: readonly string[], directory: string): Promise<Browser.File[]> {
  const { open } = await import("node:fs/promises")
  const { resolve, basename, extname } = await import("node:path")
  const files = await Promise.all(
    paths.map(async (input) => {
      const file = await open(resolve(directory, input), "r")
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.size > Browser.MAX_FILE_BYTES)
          throw new Error("Upload must be a file no larger than 5 MiB.")
        return {
          id: Browser.FileID.make(`file_${crypto.randomUUID()}`),
          name: basename(input),
          mime: types[extname(input).toLowerCase()] ?? "application/octet-stream",
          data: new Uint8Array(await file.readFile()),
        }
      } finally {
        await file.close()
      }
    }),
  )
  if (files.reduce((size, file) => size + file.data.byteLength, 0) > Browser.MAX_FILE_BYTES)
    throw new Error("File transfer exceeds 5 MiB total.")
  return files
}

const types: Record<string, string> = {
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".html": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".gz": "application/gzip",
}

export async function save(files: readonly Browser.File[]): Promise<Browser.FileInfo[]> {
  if (files.length === 0) return []
  if (files.reduce((size, file) => size + file.data.byteLength, 0) > Browser.MAX_FILE_BYTES)
    throw new Error("File transfer exceeds 5 MiB total. Capture a smaller file.")
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises")
  const { join } = await import("node:path")
  const { tmpdir } = await import("node:os")
  const directory = await mkdtemp(join(tmpdir(), "opencode-browser-"))
  return Promise.all(
    files.map(async (file, index) => {
      const name = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-160) || "capture"
      await mkdir(join(directory, String(index)))
      const path = join(directory, String(index), name)
      await writeFile(path, file.data, { flag: "wx" })
      return { id: file.id, name: file.name, mime: file.mime, bytes: file.data.byteLength, path }
    }),
  )
}

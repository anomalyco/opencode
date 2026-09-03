import { Browser } from "@opencode-ai/schema/browser"
import { mkdir, readFile, stat, writeFile, rm } from "node:fs/promises"
import { mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

export type BrowserFiles = ReturnType<typeof createBrowserFiles>

export function createBrowserFiles() {
  const directory = path.join(tmpdir(), `opencode-browser-client-${crypto.randomUUID()}`)
  const files = new Map<
    Browser.FileID,
    {
      id: Browser.FileID
      name: string
      mime: string
      bytes: number
      state: "pending" | "completed" | "failed"
      path: string
    }
  >()
  const ready = mkdir(directory, { recursive: true })
  return {
    directory,
    ready,
    list: () => Array.from(files.values()).map(({ path: _path, ...file }) => file),
    add(name: string, mime: string) {
      const id = Browser.FileID.make(`file_${crypto.randomUUID()}`)
      const target = path.join(directory, id)
      // setSavePath must run during Electron's synchronous will-download callback.
      mkdirSync(target, { recursive: true })
      const file = {
        id,
        name: name.slice(0, 2_048),
        mime,
        bytes: 0,
        state: "pending" as "pending" | "completed" | "failed",
        path: path.join(target, name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "file"),
      }
      files.set(id, file)
      return file
    },
    async save(name: string, mime: string, data: Uint8Array) {
      if (data.byteLength > Browser.MAX_FILE_BYTES)
        throw new Error("File exceeds the 5 MiB transfer limit. Capture a smaller file.")
      await ready
      const file = this.add(name, mime)
      await writeFile(file.path, data)
      file.bytes = data.byteLength
      file.state = "completed"
      return file.id
    },
    get(id: Browser.FileID) {
      const file = files.get(id)
      if (!file || file.state !== "completed")
        throw new Error("File is not available in this tab. Call browser.files.list.")
      return file
    },
    async transfer(id: Browser.FileID): Promise<Browser.File> {
      const file = this.get(id)
      if ((await stat(file.path)).size > Browser.MAX_FILE_BYTES)
        throw new Error("File exceeds the 5 MiB transfer limit.")
      return { id, name: file.name, mime: file.mime, data: new Uint8Array(await readFile(file.path)) }
    },
    dispose: () => ready.then(() => rm(directory, { recursive: true, force: true })),
  }
}

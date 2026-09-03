import { Browser } from "@opencode-ai/plugin-browser/rpc"
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
        throw new Error(
          "Capture exceeds the 5 MiB transfer limit. Reduce screenshot maxWidth/quality or trace duration; for a heap snapshot, use a smaller page/test case. Do not retry an identical capture.",
        )
      await ready
      const file = this.add(name, mime)
      await writeFile(file.path, data).catch((error: unknown) => {
        file.state = "failed"
        throw new Error(
          "Cannot write the capture on the desktop. Ask the user to check desktop temporary-directory access and free space before retrying.",
          { cause: error },
        )
      })
      file.bytes = data.byteLength
      file.state = "completed"
      return file.id
    },
    get(id: Browser.FileID) {
      const file = files.get(id)
      if (!file)
        throw new Error(
          "File ID is not retained in this tab. Call browser.files.list({tabID}) and use an exact returned fileID from the same tab, not a server path or request ID.",
        )
      if (file.state === "pending")
        throw new Error(
          "File is still being downloaded or captured. Check browser.files.list({tabID}) again and wait for state completed; do not start a duplicate download.",
        )
      if (file.state === "failed")
        throw new Error(
          "The download or capture failed, so this file cannot be read. Inspect browser.console and browser.network.list for the cause before deciding to start it again.",
        )
      return file
    },
    async transfer(id: Browser.FileID): Promise<Browser.File> {
      const file = this.get(id)
      if (
        (
          await stat(file.path).catch((error: unknown) => {
            throw unavailableFile(error)
          })
        ).size > Browser.MAX_FILE_BYTES
      )
        throw new Error(
          "File exceeds the 5 MiB transfer limit. Choose a smaller completed file; repeating browser.files.get for this file will not help.",
        )
      const data = await readFile(file.path).catch((error: unknown) => {
        throw unavailableFile(error)
      })
      return { id, name: file.name, mime: file.mime, data: new Uint8Array(data) }
    },
    dispose: () => ready.then(() => rm(directory, { recursive: true, force: true })),
  }
}

function unavailableFile(error: unknown) {
  return new Error(
    "The retained file cannot be read on the desktop. Its temporary copy may have been removed. Use an already exported server-local path if available, or deliberately create a new capture.",
    { cause: error },
  )
}

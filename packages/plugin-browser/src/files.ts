export * as BrowserFiles from "./files.js"

import { Browser } from "./rpc.js"
import { Tool } from "@opencode-ai/schema/tool"
import { Effect } from "effect"

export const resolve = Effect.fn("BrowserFiles.resolve")((inputs: readonly string[], directory: string) =>
  Effect.tryPromise({
    try: async () => {
      const { realpath } = await import("node:fs/promises")
      const { resolve, relative, isAbsolute, sep } = await import("node:path")
      const root = await realpath(directory)
      const paths = await Promise.all(inputs.map((file) => realpath(resolve(directory, file))))
      return {
        paths,
        external: paths.filter((file) => {
          const value = relative(root, file)
          return value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)
        }),
      }
    },
    catch: (error) => failure("resolve", error),
  }),
)

// Files cross machines as bytes. Only this endpoint interprets its local paths.
export const read = Effect.fn("BrowserFiles.read")((paths: readonly string[], directory: string) =>
  Effect.tryPromise({
    try: async () => {
      const { open } = await import("node:fs/promises")
      const { resolve, basename, extname } = await import("node:path")
      const files = await Promise.all(
        paths.map(async (input) => {
          const file = await open(resolve(directory, input), "r")
          try {
            const stat = await file.stat()
            if (!stat.isFile())
              throw new Error("Upload paths must name files, not directories. Select a server-local file.")
            if (stat.size > Browser.MAX_FILE_BYTES)
              throw new Error(
                `Upload is ${stat.size} bytes; the limit is ${Browser.MAX_FILE_BYTES} bytes (5 MiB). Select a smaller file; do not retry the same upload.`,
              )
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
        throw new Error(
          "The selected upload files exceed 5 MiB in total. Send fewer or smaller files; splitting them into one batch does not bypass the total limit.",
        )
      return files
    },
    catch: (error) => failure("read", error),
  }),
)

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

export const save = Effect.fn("BrowserFiles.save")((files: readonly Browser.File[]) =>
  Effect.tryPromise({
    try: async () => {
      if (files.length === 0) return []
      if (files.reduce((size, file) => size + file.data.byteLength, 0) > Browser.MAX_FILE_BYTES)
        throw new Error(
          "Capture files exceed the 5 MiB total transfer limit. Use a smaller screenshot, a shorter trace/profile, or a smaller page for heap capture; do not retry the identical capture.",
        )
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
    },
    catch: (error) => failure("save", error),
  }),
)

function failure(operation: "resolve" | "read" | "save", error: unknown) {
  const detail = error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400)
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string" && !detail.startsWith(error.code)
      ? `${error.code}: `
      : ""
  const recovery =
    operation === "save"
      ? "The browser may have completed the capture, but no server-local export is confirmed. Check free space and write access on the server. Use browser.files.list({tabID}) and browser.files.get({tabID,fileID}) to retrieve an existing completed capture instead of repeating its browser action."
      : "Upload paths are on the server, not the desktop. Check that each path exists, is a file, and is readable on the server; correct paths or select smaller files before retrying."
  return new Tool.Error({
    message: `Cannot ${operation} browser files on the server. ${recovery} Details: ${code}${detail}`,
    error,
  })
}

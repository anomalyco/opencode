export * as BrowserFiles from "./files.js"

import { Browser } from "./rpc.js"
import { Tool } from "@opencode/schema/tool"
import { Effect } from "effect"

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

/**
 * Where a preview path points on this server, and whether a file is there. The Review pane resolves a relative path
 * against the workspace, or failing that to the one workspace file whose path ends with it, and it accepts file://
 * URLs and line suffixes (`:12`, `#L12`). `found` is undefined when that suffix search was too large to finish here,
 * and the whole result is undefined for addresses that are not server files, such as https: or skill: links.
 */
export const locate = Effect.fn("BrowserFiles.locate")(function* (path: string, directory: string) {
  const value = path.trim()
  if (/^[a-z][a-z\d+.-]+:/i.test(value) && !/^file:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return undefined
  return yield* Effect.tryPromise(async (): Promise<Located> => {
    const { stat } = await import("node:fs/promises")
    const { isAbsolute, resolve } = await import("node:path")
    const { fileURLToPath } = await import("node:url")
    const local = /^file:/i.test(value) ? (URL.canParse(value) ? fileURLToPath(new URL(value)) : value) : value
    const plain = local.replace(/(?:#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?|:\d+(?::\d+)?(?:-\d+(?::\d+)?)?:?)$/i, "")
    // A model whose user is on Windows writes site\index.html to a server on any system; the pane reads a backslash as
    // a separator everywhere, so this does too once the path as written names nothing.
    const slashed = plain.replaceAll("\\", "/")
    const candidates = [local, plain, slashed]
    const kinds = await Promise.all(
      candidates.map((candidate) =>
        stat(resolve(directory, candidate)).then(
          (info) => (info.isFile() ? "file" : info.isDirectory() ? "directory" : "other"),
          () => undefined,
        ),
      ),
    )
    const index = [kinds.indexOf("file"), kinds.indexOf("directory"), kinds.indexOf("other")].find((at) => at >= 0)
    const absolute = resolve(directory, candidates[index ?? 2] ?? slashed)
    if (kinds.includes("file")) return { absolute, found: true, directory: false }
    if (kinds.includes("directory")) return { absolute, found: false, directory: true }
    if (isAbsolute(plain)) return { absolute, found: false, directory: false }
    return { absolute, found: await findBySuffix(directory, plain), directory: false }
  }).pipe(
    // A path this server cannot even parse is left for the pane to judge, as before.
    Effect.orElseSucceed(() => undefined),
  )
})

type Located = { readonly absolute: string; readonly found: boolean | undefined; readonly directory: boolean }

// The pane's search index skips ignored files; skipping dependency and VCS folders keeps this walk small too.
async function findBySuffix(directory: string, relative: string) {
  const { readdir } = await import("node:fs/promises")
  const { join } = await import("node:path")
  const target = relative.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "")
  const queue = [""]
  const budget = { entries: 20_000 }
  while (queue.length > 0) {
    const folder = queue.shift() ?? ""
    const entries = await readdir(join(directory, folder), { withFileTypes: true }).catch(() => [])
    budget.entries -= entries.length
    if (budget.entries < 0) return undefined
    const files = entries.map((entry) => ({ entry, path: folder ? `${folder}/${entry.name}` : entry.name }))
    if (files.some((file) => file.entry.isFile() && (file.path === target || file.path.endsWith(`/${target}`))))
      return true
    queue.push(
      ...files
        .filter(
          (file) => file.entry.isDirectory() && !file.entry.name.startsWith(".") && file.entry.name !== "node_modules",
        )
        .map((file) => file.path),
    )
  }
  return false
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
          const name = captureName(file.name)
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

// `.`/`..` escape the per-file directory and Windows resolves device names such as CON.txt regardless of directory.
export function captureName(name: string) {
  const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-160)
  if (!sanitized || /^\.{1,2}$/.test(sanitized) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(sanitized))
    return "capture"
  return sanitized
}

function failure(operation: "read" | "save", error: unknown) {
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

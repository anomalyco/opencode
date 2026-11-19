export * as BrowserFiles from "./files.js"

import { Browser } from "./rpc.js"
import { Tool } from "@opencode/schema/tool"
import { Effect } from "effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { workspaceTarget } from "./workspace.js"
import { previewPath } from "./preview-path.js"
import { open, realpath, stat } from "node:fs/promises"
import { basename, dirname, extname, join, parse, relative, resolve } from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

// Match core FileAccess's lexical resources; the plugin SDK exposes permission.assert, not FileAccess.Service.
export const authorize = Effect.fn("BrowserFiles.authorize")(function* (
  ctx: Pick<Context, "permission" | "location">, tool: Tool.Context, action: "read" | "edit", paths: readonly string[],
) {
  if (ctx.location.workspaceID) return yield* new Tool.Error({ message: "Browser file transfers require a server-local workspace." })
  const directory = ctx.location.directory
  const project = ctx.location.project.directory
  const outside = paths.filter((file) => !FSUtil.contains(directory, file) && (project === parse(project).root || !FSUtil.contains(project, file)))
  const invocation = { sessionID: tool.sessionID, agent: tool.agent, source: { type: "tool" as const, messageID: tool.messageID, id: tool.id }, metadata: { input: { paths } } }
  if (outside.length) yield* ctx.permission.assert({ ...invocation, action: "external_directory", resources: [...new Set(outside.map((file) => join(dirname(file), "*").replaceAll("\\", "/")))], save: [] })
  const resources = paths.map((file) => (outside.includes(file) ? file : relative(directory, file) || ".").replaceAll("\\", "/"))
  yield* ctx.permission.assert({ ...invocation, action, resources, save: outside.length || resources.some((r) => /[*?]/.test(r)) ? [] : resources })
})

export function uploadPath(directory: string, input: string) {
  const path = FSUtil.windowsPath(input)
  return resolve(directory, path === "~" ? Global.Path.home : /^~\//.test(path) || (process.platform === "win32" && path.startsWith("~\\")) ? join(Global.Path.home, path.slice(2)) : path)
}

export const physical = (paths: readonly string[]) => Effect.tryPromise({ try: () => Promise.all(paths.map((path) => realpath(path))), catch: (error) => failure("read", error) })

// Files cross machines as bytes. Only this endpoint interprets its local paths.
export const read = Effect.fn("BrowserFiles.read")((paths: readonly string[], names: readonly string[]) =>
  Effect.tryPromise({
    try: async () => {
      const files: Browser.File[] = []
      let remaining = Browser.MAX_FILE_BYTES
      for (const [index, input] of paths.entries()) {
          const file = await open(input, "r")
          try {
            const info = await file.stat()
            if (!info.isFile()) throw new Error("Upload paths must name regular files.")
            if (info.size > remaining) throw new Error("The selected upload files exceed 5 MiB in total.")
            const data = Buffer.alloc(info.size)
            let offset = 0
            while (offset < data.length) {
              const { bytesRead } = await file.read(data, offset, data.length - offset, offset)
              if (!bytesRead) throw new Error("The upload file changed while it was being read.")
              offset += bytesRead
            }
            remaining -= data.length
            const name = basename(names[index] ?? input)
            files.push({
              id: Browser.FileID.make(`file_${crypto.randomUUID()}`),
              name,
              mime: types[extname(name).toLowerCase()] ?? "application/octet-stream",
              data,
            })
          } finally {
            await file.close()
          }
      }
      return files
    },
    catch: (error) => failure("read", error),
  }),
)

/**
 * The workspace entry a path or `file:` address names, decided from its text alone, with no look at the disk: the
 * address and its percent-encoding decoded, a line suffix dropped, `.` and `..` resolved. `entry` is the result
 * relative to the workspace, with forward slashes. Undefined for an address that is no file. `unresolved` for text
 * that is no path, `outside` for one that leaves the workspace, `invalid` for a name the desktop cannot open.
 */
export function entry(path: string, directory: string) {
  const value = path.trim()
  if (address(value) && !/^file:/i.test(value)) return undefined
  const local = localPath(value)
  if (local === undefined) return { unresolved: true as const }
  if (local === "") return { absolute: value, outside: true as const }
  const plain = local.replace(/(?:#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?|:\d+(?::\d+)?(?:-\d+(?::\d+)?)?:?)$/i, "")
  const absolute = resolve(directory, plain)
  if (!FSUtil.contains(directory, absolute)) return { absolute, outside: true as const }
  const name = relative(directory, absolute).replaceAll("\\", "/")
  if (name && !previewPath(name, process.platform === "win32")) return { absolute, invalid: true as const }
  return { absolute, entry: name }
}

// A `file:` address as a local path, with forward slashes. Empty for one that names another host; undefined for text
// that is no address or path at all.
function localPath(value: string) {
  try {
    const url = /^file:/i.test(value) ? new URL(value) : undefined
    if (url?.hostname) return ""
    return (url ? fileURLToPath(url) : value).replaceAll("\\", "/")
  } catch {
    return undefined
  }
}

/** Resolve and authorize the exact entry. A missing agent path must not trigger a search of unapproved directories. */
export const locate = Effect.fn("BrowserFiles.locate")(function* (path: string, directory: string, approve: (absolute: string) => Effect.Effect<void, Tool.Error>) {
  const resolved = entry(path, directory)
  if (!resolved) return undefined
  const invalid = () => new Tool.Error({ metadata: { code: "unresolved_path" }, message: "This path does not resolve to a file inside the workspace." })
  if ("unresolved" in resolved) return yield* invalid()
  const absolute = resolved.absolute
  const missing = { absolute, found: false, directory: false }
  // Outside and invalid names can be refused lexically, without querying the filesystem or prompting to read them.
  if ("outside" in resolved) return { ...missing, outside: true }
  if ("invalid" in resolved) return { ...missing, invalid: true }
  yield* approve(absolute)
  const target = yield* Effect.tryPromise({ try: () => workspaceTarget(absolute, [directory]), catch: cause => cause instanceof Error && "code" in cause && (cause.code === "ENOENT" || cause.code === "ENOTDIR") ? "missing" as const : invalid() }).pipe(
    Effect.catchIf(error => error === "missing", () => Effect.succeed(null)),
  )
  if (target === null) return missing
  if (!target) return { ...missing, outside: true }
  // The physical file, named under the workspace as the session spells it: a workspace reached through a symlink
  // (macOS's /var is /private/var) keeps its own path, and only a link inside it to another entry needs approval.
  const root = yield* Effect.tryPromise({ try: () => realpath(directory), catch: invalid })
  const physical = resolve(directory, relative(root, target))
  if (physical !== absolute) yield* approve(physical)
  const info = yield* Effect.tryPromise({ try: () => stat(target), catch: invalid })
  return { absolute: physical, found: info.isFile(), directory: info.isDirectory() }
})

/** Whether a preview path is an address with a scheme, such as https:, skill: or file:. A drive letter is no scheme. */
export function address(path: string) {
  return /^[a-z][a-z\d+.-]+:/i.test(path.trim())
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

/** A session owns one private cache tree. Neither file names nor session IDs are interpreted as directory paths. */
export function exportRoot(sessionID: string) {
  return join(Global.Path.cache, "browser-exports", createHash("sha256").update(sessionID).digest("hex"))
}

export function exportPaths(files: readonly Browser.File[], root: string) {
  const directory = join(root, crypto.randomUUID())
  return { directory, paths: files.map((file, index) => join(directory, String(index), captureName(file.name))) }
}

export const save = Effect.fn("BrowserFiles.save")((files: readonly Browser.File[], plan: ReturnType<typeof exportPaths>) =>
  Effect.tryPromise({
    try: async () => {
      if (files.length === 0) return []
      if (files.reduce((size, file) => size + file.data.byteLength, 0) > Browser.MAX_FILE_BYTES)
        throw new Error(
          "Capture files exceed the 5 MiB total transfer limit. Use a smaller screenshot, a shorter trace/profile, or a smaller page for heap capture; do not retry the identical capture.",
        )
      const { mkdir, writeFile } = await import("node:fs/promises")
      await mkdir(dirname(plan.directory), { recursive: true, mode: 0o700 })
      await mkdir(plan.directory, { mode: 0o700 })
      return Promise.all(
        files.map(async (file, index) => {
          const path = plan.paths[index]!
          await mkdir(dirname(path), { mode: 0o700 })
          await writeFile(path, file.data, { flag: "wx", mode: 0o600 })
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

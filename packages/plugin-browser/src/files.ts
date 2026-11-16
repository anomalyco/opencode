export * as BrowserFiles from "./files.js"

import { Browser } from "./rpc.js"
import { Tool } from "@opencode/schema/tool"
import { Effect } from "effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { openContained } from "@opencode/util/contained-file"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { workspaceTarget } from "./workspace.js"
import { previewPath } from "./preview-path.js"
import { realpath, stat } from "node:fs/promises"
import { basename, dirname, extname, join, parse, relative, resolve } from "node:path"
import { tmpdir } from "node:os"

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
          const opened = await openContained(dirname(input), basename(input))
          if (!opened) throw new Error("Upload paths must name regular files.")
          const file = opened.file
          try {
            if (opened.path !== input) throw new Error("The upload target changed after permission was checked.")
            if (opened.size > remaining) throw new Error("The selected upload files exceed 5 MiB in total.")
            const data = Buffer.alloc(opened.size)
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
 * Where a preview path points on this server, and whether a file is there. The Review pane resolves a relative path
 * against the workspace, or failing that to the one workspace file whose path ends with it, and it accepts file://
 * URLs and line suffixes (`:12`, `#L12`). `found` is undefined when that suffix search was too large to finish here,
 * and the whole result is undefined for addresses that are not server files, such as https: or skill: links.
 */
export const locate = Effect.fn("BrowserFiles.locate")(function* (path: string, directory: string) {
  const value = path.trim()
  if (address(value) && !/^file:/i.test(value)) return undefined
  return yield* Effect.tryPromise(async (): Promise<Located> => {
    const { isAbsolute, relative } = await import("node:path")
    const { fileURLToPath } = await import("node:url")
    const url = /^file:/i.test(value) ? new URL(value) : undefined
    if (url?.hostname) return { absolute: value, found: false, directory: false, outside: true }
    const local = (url ? fileURLToPath(url) : value).replaceAll("\\", "/")
    const plain = local.replace(/(?:#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?|:\d+(?::\d+)?(?:-\d+(?::\d+)?)?:?)$/i, "")
    const check = async (candidate: string): Promise<Located | undefined> => {
      const absolute = resolve(directory, candidate)
      const path = relative(directory, absolute).replaceAll("\\", "/")
      if (isAbsolute(path) || path === ".." || path.startsWith("../")) return { absolute, found: false, directory: false, outside: true }
      if (path && !previewPath(path, process.platform === "win32")) return { absolute, found: false, directory: false, invalid: true }
      try {
        const target = await workspaceTarget(absolute, [directory])
        if (!target) return { absolute, found: false, directory: false, outside: true }
        const info = await stat(target)
        return { absolute, found: info.isFile(), directory: info.isDirectory() }
      } catch (cause) {
        if (cause instanceof Error && "code" in cause && (cause.code === "ENOENT" || cause.code === "ENOTDIR")) return
        throw cause
      }
    }
    const exact = await check(plain)
    if (exact) return exact
    const absolute = resolve(directory, plain)
    if (isAbsolute(plain)) return { absolute, found: false, directory: false }
    const match = await findBySuffix(directory, plain)
    if (typeof match !== "string") return { absolute, found: match, directory: false }
    return await check(match) ?? { absolute, found: false, directory: false }
  }).pipe(
    Effect.mapError(() => new Tool.Error({ metadata: { code: "unresolved_path" }, message: "browser.preview could not resolve this file inside the workspace." })),
  )
})

/** Whether a preview path is an address with a scheme, such as https:, skill: or file:. A drive letter is no scheme. */
export function address(path: string) {
  return /^[a-z][a-z\d+.-]+:/i.test(path.trim())
}

type Located = { readonly absolute: string; readonly found: boolean | undefined; readonly directory: boolean; readonly outside?: true; readonly invalid?: true }

// The pane's search index skips ignored files; skipping dependency and VCS folders keeps this walk small too.
async function findBySuffix(directory: string, relative: string) {
  const { readdir } = await import("node:fs/promises")
  const { join } = await import("node:path")
  const target = relative.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "")
  const queue = [""]
  const matches: string[] = []
  const budget = { entries: 20_000 }
  while (queue.length > 0) {
    const folder = queue.shift() ?? ""
    const entries = await readdir(join(directory, folder), { withFileTypes: true }).catch(() => [])
    budget.entries -= entries.length
    if (budget.entries < 0) return undefined
    const files = entries.map((entry) => ({ entry, path: folder ? `${folder}/${entry.name}` : entry.name }))
    matches.push(...files.filter((file) => file.entry.isFile() && file.path.endsWith(`/${target}`)).map((file) => file.path))
    if (matches.length > 1) return undefined
    queue.push(
      ...files
        .filter(
          (file) => file.entry.isDirectory() && !file.entry.name.startsWith(".") && file.entry.name !== "node_modules",
        )
        .map((file) => file.path),
    )
  }
  return matches[0] ?? false
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

export function exportPaths(files: readonly Browser.File[]) {
  const directory = join(tmpdir(), `opencode-browser-${crypto.randomUUID()}`)
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

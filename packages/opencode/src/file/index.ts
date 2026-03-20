import { BusEvent } from "@/bus/bus-event"
import { InstanceContext } from "@/effect/instance-context"
import { runPromiseInstance } from "@/effect/runtime"
import { git } from "@/util/git"
import { Effect, Fiber, Layer, Scope, ServiceMap } from "effect"
import { formatPatch, structuredPatch } from "diff"
import fs from "fs"
import fuzzysort from "fuzzysort"
import ignore from "ignore"
import path from "path"
import z from "zod"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { Protected } from "./protected"
import { Ripgrep } from "./ripgrep"

export namespace File {
  export const Info = z
    .object({
      path: z.string(),
      added: z.number().int(),
      removed: z.number().int(),
      status: z.enum(["added", "deleted", "modified"]),
    })
    .meta({
      ref: "File",
    })

  export type Info = z.infer<typeof Info>

  export const Node = z
    .object({
      name: z.string(),
      path: z.string(),
      absolute: z.string(),
      type: z.enum(["file", "directory"]),
      ignored: z.boolean(),
    })
    .meta({
      ref: "FileNode",
    })
  export type Node = z.infer<typeof Node>

  export const Content = z
    .object({
      type: z.enum(["text", "binary"]),
      content: z.string(),
      diff: z.string().optional(),
      patch: z
        .object({
          oldFileName: z.string(),
          newFileName: z.string(),
          oldHeader: z.string().optional(),
          newHeader: z.string().optional(),
          hunks: z.array(
            z.object({
              oldStart: z.number(),
              oldLines: z.number(),
              newStart: z.number(),
              newLines: z.number(),
              lines: z.array(z.string()),
            }),
          ),
          index: z.string().optional(),
        })
        .optional(),
      encoding: z.literal("base64").optional(),
      mimeType: z.string().optional(),
    })
    .meta({
      ref: "FileContent",
    })
  export type Content = z.infer<typeof Content>

  export const Event = {
    Edited: BusEvent.define(
      "file.edited",
      z.object({
        file: z.string(),
      }),
    ),
  }

  export function init() {
    return runPromiseInstance(Service.use((svc) => svc.init()))
  }

  export async function status() {
    return runPromiseInstance(Service.use((svc) => svc.status()))
  }

  export async function read(file: string): Promise<Content> {
    return runPromiseInstance(Service.use((svc) => svc.read(file)))
  }

  export async function list(dir?: string) {
    return runPromiseInstance(Service.use((svc) => svc.list(dir)))
  }

  export async function search(input: { query: string; limit?: number; dirs?: boolean; type?: "file" | "directory" }) {
    return runPromiseInstance(Service.use((svc) => svc.search(input)))
  }

  const log = Log.create({ service: "file" })

  const binary = new Set([
    "exe",
    "dll",
    "pdb",
    "bin",
    "so",
    "dylib",
    "o",
    "a",
    "lib",
    "wav",
    "mp3",
    "ogg",
    "oga",
    "ogv",
    "ogx",
    "flac",
    "aac",
    "wma",
    "m4a",
    "weba",
    "mp4",
    "avi",
    "mov",
    "wmv",
    "flv",
    "webm",
    "mkv",
    "zip",
    "tar",
    "gz",
    "gzip",
    "bz",
    "bz2",
    "bzip",
    "bzip2",
    "7z",
    "rar",
    "xz",
    "lz",
    "z",
    "pdf",
    "doc",
    "docx",
    "ppt",
    "pptx",
    "xls",
    "xlsx",
    "dmg",
    "iso",
    "img",
    "vmdk",
    "ttf",
    "otf",
    "woff",
    "woff2",
    "eot",
    "sqlite",
    "db",
    "mdb",
    "apk",
    "ipa",
    "aab",
    "xapk",
    "app",
    "pkg",
    "deb",
    "rpm",
    "snap",
    "flatpak",
    "appimage",
    "msi",
    "msp",
    "jar",
    "war",
    "ear",
    "class",
    "kotlin_module",
    "dex",
    "vdex",
    "odex",
    "oat",
    "art",
    "wasm",
    "wat",
    "bc",
    "ll",
    "s",
    "ko",
    "sys",
    "drv",
    "efi",
    "rom",
    "com",
    "cmd",
    "ps1",
    "sh",
    "bash",
    "zsh",
    "fish",
  ])

  const image = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "bmp",
    "webp",
    "ico",
    "tif",
    "tiff",
    "svg",
    "svgz",
    "avif",
    "apng",
    "jxl",
    "heic",
    "heif",
    "raw",
    "cr2",
    "nef",
    "arw",
    "dng",
    "orf",
    "raf",
    "pef",
    "x3f",
  ])

  const text = new Set([
    "ts",
    "tsx",
    "mts",
    "cts",
    "mtsx",
    "ctsx",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "sh",
    "bash",
    "zsh",
    "fish",
    "ps1",
    "psm1",
    "cmd",
    "bat",
    "json",
    "jsonc",
    "json5",
    "yaml",
    "yml",
    "toml",
    "md",
    "mdx",
    "txt",
    "xml",
    "html",
    "htm",
    "css",
    "scss",
    "sass",
    "less",
    "graphql",
    "gql",
    "sql",
    "ini",
    "cfg",
    "conf",
    "env",
  ])

  const textName = new Set([
    "dockerfile",
    "makefile",
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
    ".npmrc",
    ".nvmrc",
    ".prettierrc",
    ".eslintrc",
  ])

  const mime: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    bmp: "image/bmp",
    webp: "image/webp",
    ico: "image/x-icon",
    tif: "image/tiff",
    tiff: "image/tiff",
    svg: "image/svg+xml",
    svgz: "image/svg+xml",
    avif: "image/avif",
    apng: "image/apng",
    jxl: "image/jxl",
    heic: "image/heic",
    heif: "image/heif",
  }

  type Entry = { files: string[]; dirs: string[] }

  const ext = (file: string) => path.extname(file).toLowerCase().slice(1)
  const name = (file: string) => path.basename(file).toLowerCase()
  const isImageByExtension = (file: string) => image.has(ext(file))
  const isTextByExtension = (file: string) => text.has(ext(file))
  const isTextByName = (file: string) => textName.has(name(file))
  const isBinaryByExtension = (file: string) => binary.has(ext(file))
  const isImage = (mimeType: string) => mimeType.startsWith("image/")
  const getImageMimeType = (file: string) => mime[ext(file)] || "image/" + ext(file)

  function shouldEncode(mimeType: string) {
    const type = mimeType.toLowerCase()
    log.info("shouldEncode", { type })
    if (!type) return false
    if (type.startsWith("text/")) return false
    if (type.includes("charset=")) return false
    const top = type.split("/", 2)[0]
    return ["image", "audio", "video", "font", "model", "multipart"].includes(top)
  }

  const hidden = (item: string) => {
    const normalized = item.replaceAll("\\", "/").replace(/\/+$/, "")
    return normalized.split("/").some((part) => part.startsWith(".") && part.length > 1)
  }

  const sortHiddenLast = (items: string[], prefer: boolean) => {
    if (prefer) return items
    const visible: string[] = []
    const hiddenItems: string[] = []
    for (const item of items) {
      if (hidden(item)) hiddenItems.push(item)
      else visible.push(item)
    }
    return [...visible, ...hiddenItems]
  }

  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly status: () => Effect.Effect<File.Info[]>
    readonly read: (file: string) => Effect.Effect<File.Content>
    readonly list: (dir?: string) => Effect.Effect<File.Node[]>
    readonly search: (input: {
      query: string
      limit?: number
      dirs?: boolean
      type?: "file" | "directory"
    }) => Effect.Effect<string[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/File") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const instance = yield* InstanceContext
      let cache: Entry = { files: [], dirs: [] }
      const isGlobalHome = instance.directory === Global.Path.home && instance.project.id === "global"

      const scan = Effect.fn("File.scan")(function* () {
        if (instance.directory === path.parse(instance.directory).root) return
        const next: Entry = { files: [], dirs: [] }

        yield* Effect.promise(async () => {
          if (isGlobalHome) {
            const dirs = new Set<string>()
            const protectedNames = Protected.names()
            const ignoreNested = new Set(["node_modules", "dist", "build", "target", "vendor"])
            const shouldIgnoreName = (name: string) => name.startsWith(".") || protectedNames.has(name)
            const shouldIgnoreNested = (name: string) => name.startsWith(".") || ignoreNested.has(name)
            const top = await fs.promises
              .readdir(instance.directory, { withFileTypes: true })
              .catch(() => [] as fs.Dirent[])

            for (const entry of top) {
              if (!entry.isDirectory()) continue
              if (shouldIgnoreName(entry.name)) continue
              dirs.add(entry.name + "/")

              const base = path.join(instance.directory, entry.name)
              const children = await fs.promises.readdir(base, { withFileTypes: true }).catch(() => [] as fs.Dirent[])
              for (const child of children) {
                if (!child.isDirectory()) continue
                if (shouldIgnoreNested(child.name)) continue
                dirs.add(entry.name + "/" + child.name + "/")
              }
            }

            next.dirs = Array.from(dirs).toSorted()
          } else {
            const seen = new Set<string>()
            for await (const file of Ripgrep.files({ cwd: instance.directory })) {
              next.files.push(file)
              let current = file
              while (true) {
                const dir = path.dirname(current)
                if (dir === ".") break
                if (dir === current) break
                current = dir
                if (seen.has(dir)) continue
                seen.add(dir)
                next.dirs.push(dir + "/")
              }
            }
          }
        })

        cache = next
      })

      const getFiles = () => cache

      const scope = yield* Scope.Scope
      let fiber: Fiber.Fiber<void> | undefined

      const init = Effect.fn("File.init")(function* () {
        if (!fiber) {
          fiber = yield* scan().pipe(
            Effect.catchCause(() => Effect.void),
            Effect.forkIn(scope),
          )
        }
        yield* Fiber.join(fiber)
      })

      const status = Effect.fn("File.status")(function* () {
        if (instance.project.vcs !== "git") return []

        return yield* Effect.promise(async () => {
          const diffOutput = (
            await git(["-c", "core.fsmonitor=false", "-c", "core.quotepath=false", "diff", "--numstat", "HEAD"], {
              cwd: instance.directory,
            })
          ).text()

          const changed: File.Info[] = []

          if (diffOutput.trim()) {
            for (const line of diffOutput.trim().split("\n")) {
              const [added, removed, file] = line.split("\t")
              changed.push({
                path: file,
                added: added === "-" ? 0 : parseInt(added, 10),
                removed: removed === "-" ? 0 : parseInt(removed, 10),
                status: "modified",
              })
            }
          }

          const untrackedOutput = (
            await git(
              [
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.quotepath=false",
                "ls-files",
                "--others",
                "--exclude-standard",
              ],
              {
                cwd: instance.directory,
              },
            )
          ).text()

          if (untrackedOutput.trim()) {
            for (const file of untrackedOutput.trim().split("\n")) {
              try {
                const content = await Filesystem.readText(path.join(instance.directory, file))
                changed.push({
                  path: file,
                  added: content.split("\n").length,
                  removed: 0,
                  status: "added",
                })
              } catch {
                continue
              }
            }
          }

          const deletedOutput = (
            await git(
              [
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.quotepath=false",
                "diff",
                "--name-only",
                "--diff-filter=D",
                "HEAD",
              ],
              {
                cwd: instance.directory,
              },
            )
          ).text()

          if (deletedOutput.trim()) {
            for (const file of deletedOutput.trim().split("\n")) {
              changed.push({
                path: file,
                added: 0,
                removed: 0,
                status: "deleted",
              })
            }
          }

          return changed.map((item) => {
            const full = path.isAbsolute(item.path) ? item.path : path.join(instance.directory, item.path)
            return {
              ...item,
              path: path.relative(instance.directory, full),
            }
          })
        })
      })

      const read = Effect.fn("File.read")(function* (file: string) {
        return yield* Effect.promise(async (): Promise<File.Content> => {
          using _ = log.time("read", { file })
          const full = path.join(instance.directory, file)

          if (!Instance.containsPath(full)) {
            throw new Error("Access denied: path escapes project directory")
          }

          if (isImageByExtension(file)) {
            if (await Filesystem.exists(full)) {
              const buffer = await Filesystem.readBytes(full).catch(() => Buffer.from([]))
              return {
                type: "text",
                content: buffer.toString("base64"),
                mimeType: getImageMimeType(file),
                encoding: "base64",
              }
            }
            return { type: "text", content: "" }
          }

          const knownText = isTextByExtension(file) || isTextByName(file)

          if (isBinaryByExtension(file) && !knownText) {
            return { type: "binary", content: "" }
          }

          if (!(await Filesystem.exists(full))) {
            return { type: "text", content: "" }
          }

          const mimeType = Filesystem.mimeType(full)
          const encode = knownText ? false : shouldEncode(mimeType)

          if (encode && !isImage(mimeType)) {
            return { type: "binary", content: "", mimeType }
          }

          if (encode) {
            const buffer = await Filesystem.readBytes(full).catch(() => Buffer.from([]))
            return {
              type: "text",
              content: buffer.toString("base64"),
              mimeType,
              encoding: "base64",
            }
          }

          const content = (await Filesystem.readText(full).catch(() => "")).trim()

          if (instance.project.vcs === "git") {
            let diff = (
              await git(["-c", "core.fsmonitor=false", "diff", "--", file], { cwd: instance.directory })
            ).text()
            if (!diff.trim()) {
              diff = (
                await git(["-c", "core.fsmonitor=false", "diff", "--staged", "--", file], {
                  cwd: instance.directory,
                })
              ).text()
            }
            if (diff.trim()) {
              const original = (await git(["show", `HEAD:${file}`], { cwd: instance.directory })).text()
              const patch = structuredPatch(file, file, original, content, "old", "new", {
                context: Infinity,
                ignoreWhitespace: true,
              })
              return {
                type: "text",
                content,
                patch,
                diff: formatPatch(patch),
              }
            }
          }

          return { type: "text", content }
        })
      })

      const list = Effect.fn("File.list")(function* (dir?: string) {
        return yield* Effect.promise(async () => {
          const exclude = [".git", ".DS_Store"]
          let ignored = (_: string) => false
          if (instance.project.vcs === "git") {
            const ig = ignore()
            const gitignore = path.join(instance.project.worktree, ".gitignore")
            if (await Filesystem.exists(gitignore)) {
              ig.add(await Filesystem.readText(gitignore))
            }
            const ignoreFile = path.join(instance.project.worktree, ".ignore")
            if (await Filesystem.exists(ignoreFile)) {
              ig.add(await Filesystem.readText(ignoreFile))
            }
            ignored = ig.ignores.bind(ig)
          }

          const resolved = dir ? path.join(instance.directory, dir) : instance.directory
          if (!Instance.containsPath(resolved)) {
            throw new Error("Access denied: path escapes project directory")
          }

          const nodes: File.Node[] = []
          for (const entry of await fs.promises.readdir(resolved, { withFileTypes: true }).catch(() => [])) {
            if (exclude.includes(entry.name)) continue
            const absolute = path.join(resolved, entry.name)
            const file = path.relative(instance.directory, absolute)
            const type = entry.isDirectory() ? "directory" : "file"
            nodes.push({
              name: entry.name,
              path: file,
              absolute,
              type,
              ignored: ignored(type === "directory" ? file + "/" : file),
            })
          }

          return nodes.sort((a, b) => {
            if (a.type !== b.type) return a.type === "directory" ? -1 : 1
            return a.name.localeCompare(b.name)
          })
        })
      })

      const search = Effect.fn("File.search")(function* (input: {
        query: string
        limit?: number
        dirs?: boolean
        type?: "file" | "directory"
      }) {
        return yield* Effect.promise(async () => {
          const query = input.query.trim()
          const limit = input.limit ?? 100
          const kind = input.type ?? (input.dirs === false ? "file" : "all")
          log.info("search", { query, kind })

          const result = getFiles()
          const preferHidden = query.startsWith(".") || query.includes("/.")

          if (!query) {
            if (kind === "file") return result.files.slice(0, limit)
            return sortHiddenLast(result.dirs.toSorted(), preferHidden).slice(0, limit)
          }

          const items =
            kind === "file" ? result.files : kind === "directory" ? result.dirs : [...result.files, ...result.dirs]

          const searchLimit = kind === "directory" && !preferHidden ? limit * 20 : limit
          const sorted = fuzzysort.go(query, items, { limit: searchLimit }).map((item) => item.target)
          const output = kind === "directory" ? sortHiddenLast(sorted, preferHidden).slice(0, limit) : sorted

          log.info("search", { query, kind, results: output.length })
          return output
        })
      })

      log.info("init")
      return Service.of({ init, status, read, list, search })
    }),
  )
}

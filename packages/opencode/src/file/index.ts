import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { AppFileSystem } from "@/filesystem"
import { Git } from "@/git"
import { Effect, Layer, Context } from "effect"
import { formatPatch, structuredPatch } from "diff"
import fuzzysort from "fuzzysort"
import ignore from "ignore"
import path from "path"
import z from "zod"
import { Global } from "../global"
import { Instance } from "../project/instance"
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
    log.debug("shouldEncode", { type })
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

  interface State {
    cache: Entry
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

  export class Service extends Context.Service<Service, Interface>()("@opencode/File") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const appFs = yield* AppFileSystem.Service
      const git = yield* Git.Service

      const state = yield* InstanceState.make<State>(
        Effect.fn("File.state")(() =>
          Effect.succeed({
            cache: { files: [], dirs: [] } as Entry,
          }),
        ),
      )

      const scan = Effect.fn("File.scan")(function* () {
        if (Instance.directory === path.parse(Instance.directory).root) return
        const isGlobalHome = Instance.directory === Global.Path.home && Instance.project.id === "global"
        const next: Entry = { files: [], dirs: [] }

        if (isGlobalHome) {
          const dirs = new Set<string>()
          const protectedNames = Protected.names()
          const ignoreNested = new Set(["node_modules", "dist", "build", "target", "vendor"])
          const shouldIgnoreName = (name: string) => name.startsWith(".") || protectedNames.has(name)
          const shouldIgnoreNested = (name: string) => name.startsWith(".") || ignoreNested.has(name)
          const top = yield* appFs.readDirectoryEntries(Instance.directory).pipe(Effect.orElseSucceed(() => []))

          for (const entry of top) {
            if (entry.type !== "directory") continue
            if (shouldIgnoreName(entry.name)) continue
            dirs.add(entry.name + "/")

            const base = path.join(Instance.directory, entry.name)
            const children = yield* appFs.readDirectoryEntries(base).pipe(Effect.orElseSucceed(() => []))
            for (const child of children) {
              if (child.type !== "directory") continue
              if (shouldIgnoreNested(child.name)) continue
              dirs.add(entry.name + "/" + child.name + "/")
            }
          }

          next.dirs = Array.from(dirs).toSorted()
        } else {
          const files = yield* Effect.promise(() => Array.fromAsync(Ripgrep.files({ cwd: Instance.directory })))
          const seen = new Set<string>()
          for (const file of files) {
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

        const s = yield* InstanceState.get(state)
        s.cache = next
      })

      let cachedScan = yield* Effect.cached(scan().pipe(Effect.catchCause(() => Effect.void)))

      const ensure = Effect.fn("File.ensure")(function* () {
        yield* cachedScan
        cachedScan = yield* Effect.cached(scan().pipe(Effect.catchCause(() => Effect.void)))
      })

      const gitText = Effect.fnUntraced(function* (args: string[]) {
        return (yield* git.run(args, { cwd: Instance.directory })).text()
      })

      const init = Effect.fn("File.init")(function* () {
        yield* ensure()
      })

      const status = Effect.fn("File.status")(function* () {
        if (Instance.project.vcs !== "git") return []

        const diffOutput = yield* gitText([
          "-c",
          "core.fsmonitor=false",
          "-c",
          "core.quotepath=false",
          "diff",
          "--numstat",
          "HEAD",
        ])

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

        const untrackedOutput = yield* gitText([
          "-c",
          "core.fsmonitor=false",
          "-c",
          "core.quotepath=false",
          "ls-files",
          "--others",
          "--exclude-standard",
        ])

        if (untrackedOutput.trim()) {
          for (const file of untrackedOutput.trim().split("\n")) {
            const content = yield* appFs
              .readFileString(path.join(Instance.directory, file))
              .pipe(Effect.catch(() => Effect.succeed<string | undefined>(undefined)))
            if (content === undefined) continue
            changed.push({
              path: file,
              added: content.split("\n").length,
              removed: 0,
              status: "added",
            })
          }
        }

        const deletedOutput = yield* gitText([
          "-c",
          "core.fsmonitor=false",
          "-c",
          "core.quotepath=false",
          "diff",
          "--name-only",
          "--diff-filter=D",
          "HEAD",
        ])

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
          const full = path.isAbsolute(item.path) ? item.path : path.join(Instance.directory, item.path)
          return {
            ...item,
            path: path.relative(Instance.directory, full),
          }
        })
      })

      const read: Interface["read"] = Effect.fn("File.read")(function* (file: string) {
        using _ = log.time("read", { file })
        const full = path.join(Instance.directory, file)

        if (!Instance.containsPath(full)) throw new Error("Access denied: path escapes project directory")

        if (isImageByExtension(file)) {
          const exists = yield* appFs.existsSafe(full)
          if (exists) {
            const bytes = yield* appFs.readFile(full).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())))
            return {
              type: "text" as const,
              content: Buffer.from(bytes).toString("base64"),
              mimeType: getImageMimeType(file),
              encoding: "base64" as const,
            }
          }
          return { type: "text" as const, content: "" }
        }

        const knownText = isTextByExtension(file) || isTextByName(file)

        if (isBinaryByExtension(file) && !knownText) return { type: "binary" as const, content: "" }

        const exists = yield* appFs.existsSafe(full)
        if (!exists) return { type: "text" as const, content: "" }

        const mimeType = AppFileSystem.mimeType(full)
        const encode = knownText ? false : shouldEncode(mimeType)

        if (encode && !isImage(mimeType)) return { type: "binary" as const, content: "", mimeType }

        if (encode) {
          const bytes = yield* appFs.readFile(full).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())))
          return {
            type: "text" as const,
            content: Buffer.from(bytes).toString("base64"),
            mimeType,
            encoding: "base64" as const,
          }
        }

        const content = yield* appFs.readFileString(full).pipe(
          Effect.map((s) => s.trim()),
          Effect.catch(() => Effect.succeed("")),
        )

        if (Instance.project.vcs === "git") {
          let diff = yield* gitText(["-c", "core.fsmonitor=false", "diff", "--", file])
          if (!diff.trim()) {
            diff = yield* gitText(["-c", "core.fsmonitor=false", "diff", "--staged", "--", file])
          }
          if (diff.trim()) {
            const original = yield* git.show(Instance.directory, "HEAD", file)
            const patch = structuredPatch(file, file, original, content, "old", "new", {
              context: Infinity,
              ignoreWhitespace: true,
            })
            return { type: "text" as const, content, patch, diff: formatPatch(patch) }
          }
          return { type: "text" as const, content }
        }

        return { type: "text" as const, content }
      })

      const list = Effect.fn("File.list")(function* (dir?: string) {
        const exclude = [".git", ".DS_Store"]
        let ignored = (_: string) => false
        if (Instance.project.vcs === "git") {
          const ig = ignore()
          const gitignore = path.join(Instance.project.worktree, ".gitignore")
          const gitignoreText = yield* appFs.readFileString(gitignore).pipe(Effect.catch(() => Effect.succeed("")))
          if (gitignoreText) ig.add(gitignoreText)
          const ignoreFile = path.join(Instance.project.worktree, ".ignore")
          const ignoreText = yield* appFs.readFileString(ignoreFile).pipe(Effect.catch(() => Effect.succeed("")))
          if (ignoreText) ig.add(ignoreText)
          ignored = ig.ignores.bind(ig)
        }

        const resolved = dir ? path.join(Instance.directory, dir) : Instance.directory
        if (!Instance.containsPath(resolved)) throw new Error("Access denied: path escapes project directory")

        const entries = yield* appFs.readDirectoryEntries(resolved).pipe(Effect.orElseSucceed(() => []))

        const nodes: File.Node[] = []
        for (const entry of entries) {
          if (exclude.includes(entry.name)) continue
          const absolute = path.join(resolved, entry.name)
          const file = path.relative(Instance.directory, absolute)
          const type = entry.type === "directory" ? "directory" : "file"
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

      const search = Effect.fn("File.search")(function* (input: {
        query: string
        limit?: number
        dirs?: boolean
        type?: "file" | "directory"
      }) {
        yield* ensure()
        const { cache } = yield* InstanceState.get(state)

        const query = input.query.trim()
        const limit = input.limit ?? 100
        const kind = input.type ?? (input.dirs === false ? "file" : "all")
        log.info("search", { query, kind })

        const preferHidden = query.startsWith(".") || query.includes("/.")

        if (!query) {
          if (kind === "file") return cache.files.slice(0, limit)
          return sortHiddenLast(cache.dirs.toSorted(), preferHidden).slice(0, limit)
        }

        const items =
          kind === "file" ? cache.files : kind === "directory" ? cache.dirs : [...cache.files, ...cache.dirs]

        const searchLimit = kind === "directory" && !preferHidden ? limit * 20 : limit
        const sorted = fuzzysort.go(query, items, { limit: searchLimit }).map((item) => item.target)
        const output = kind === "directory" ? sortHiddenLast(sorted, preferHidden).slice(0, limit) : sorted

        log.info("search", { query, kind, results: output.length })
        return output
      })

      log.info("init")
      return Service.of({ init, status, read, list, search })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer), Layer.provide(Git.defaultLayer))

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export function init() {
    return runPromise((svc) => svc.init())
  }

  export async function status() {
    return runPromise((svc) => svc.status())
  }

  export async function read(file: string): Promise<Content> {
    return runPromise((svc) => svc.read(file))
  }

  export async function list(dir?: string) {
    return runPromise((svc) => svc.list(dir))
  }

  export async function search(input: { query: string; limit?: number; dirs?: boolean; type?: "file" | "directory" }) {
    return runPromise((svc) => svc.search(input))
  }
}

import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { $ } from "bun"
import { formatPatch, structuredPatch } from "diff"
import path from "path"
import fs from "fs"
import ignore from "ignore"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { Instance } from "../project/instance"
import { Ripgrep } from "./ripgrep"
import fuzzysort from "fuzzysort"
import { Global } from "../global"
import { Session } from "../session"

export namespace File {
  const log = Log.create({ service: "file" })
  type SearchResult = { files: string[]; dirs: string[] }
  type ExternalCache = { key: string; time: number; value: SearchResult }
  const EXTERNAL_CACHE_TTL = 2_000
  const externalCache = new Map<string, ExternalCache>()

  function empty(): SearchResult {
    return { files: [], dirs: [] }
  }

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

  const binaryExtensions = new Set([
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

  const imageExtensions = new Set([
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

  const textExtensions = new Set([
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

  const textNames = new Set([
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

  function isImageByExtension(filepath: string): boolean {
    const ext = path.extname(filepath).toLowerCase().slice(1)
    return imageExtensions.has(ext)
  }

  function isTextByExtension(filepath: string): boolean {
    const ext = path.extname(filepath).toLowerCase().slice(1)
    return textExtensions.has(ext)
  }

  function isTextByName(filepath: string): boolean {
    const name = path.basename(filepath).toLowerCase()
    return textNames.has(name)
  }

  function getImageMimeType(filepath: string): string {
    const ext = path.extname(filepath).toLowerCase().slice(1)
    const mimeTypes: Record<string, string> = {
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
    return mimeTypes[ext] || "image/" + ext
  }

  function isBinaryByExtension(filepath: string): boolean {
    const ext = path.extname(filepath).toLowerCase().slice(1)
    return binaryExtensions.has(ext)
  }

  function isImage(mimeType: string): boolean {
    return mimeType.startsWith("image/")
  }

  async function shouldEncode(mimeType: string): Promise<boolean> {
    const type = mimeType.toLowerCase()
    log.info("shouldEncode", { type })
    if (!type) return false

    if (type.startsWith("text/")) return false
    if (type.includes("charset=")) return false

    const parts = type.split("/", 2)
    const top = parts[0]

    const tops = ["image", "audio", "video", "font", "model", "multipart"]
    if (tops.includes(top)) return true

    return false
  }

  export const Event = {
    Edited: BusEvent.define(
      "file.edited",
      z.object({
        file: z.string(),
      }),
    ),
  }

  const state = Instance.state(async () => {
    let cache: SearchResult = empty()
    let fetching = false

    const isGlobalHome = Instance.directory === Global.Path.home && Instance.project.id === "global"

    const fn = async (result: SearchResult) => {
      // Disable scanning if in root of file system
      if (Instance.directory === path.parse(Instance.directory).root) return
      fetching = true

      if (isGlobalHome) {
        const dirs = new Set<string>()
        const ignore = new Set<string>()

        if (process.platform === "darwin") ignore.add("Library")
        if (process.platform === "win32") ignore.add("AppData")

        const ignoreNested = new Set(["node_modules", "dist", "build", "target", "vendor"])
        const shouldIgnore = (name: string) => name.startsWith(".") || ignore.has(name)
        const shouldIgnoreNested = (name: string) => name.startsWith(".") || ignoreNested.has(name)

        const top = await fs.promises
          .readdir(Instance.directory, { withFileTypes: true })
          .catch(() => [] as fs.Dirent[])

        for (const entry of top) {
          if (!entry.isDirectory()) continue
          if (shouldIgnore(entry.name)) continue
          dirs.add(entry.name + "/")

          const base = path.join(Instance.directory, entry.name)
          const children = await fs.promises.readdir(base, { withFileTypes: true }).catch(() => [] as fs.Dirent[])
          for (const child of children) {
            if (!child.isDirectory()) continue
            if (shouldIgnoreNested(child.name)) continue
            dirs.add(entry.name + "/" + child.name + "/")
          }
        }

        result.dirs = Array.from(dirs).toSorted()
        cache = result
        fetching = false
        return
      }

      const set = new Set<string>()
      for await (const file of Ripgrep.files({ cwd: Instance.directory })) {
        result.files.push(file)
        let current = file
        while (true) {
          const dir = path.dirname(current)
          if (dir === ".") break
          if (dir === current) break
          current = dir
          if (set.has(dir)) continue
          set.add(dir)
          result.dirs.push(dir + "/")
        }
      }
      cache = result
      fetching = false
    }
    fn(cache)

    return {
      async files() {
        if (!fetching) {
          fn(empty())
        }
        return cache
      },
    }
  })

  export function init() {
    state()
  }

  export async function status() {
    const project = Instance.project
    if (project.vcs !== "git") return []

    const diffOutput = await $`git -c core.quotepath=false diff --numstat HEAD`
      .cwd(Instance.directory)
      .quiet()
      .nothrow()
      .text()

    const changedFiles: Info[] = []

    if (diffOutput.trim()) {
      const lines = diffOutput.trim().split("\n")
      for (const line of lines) {
        const [added, removed, filepath] = line.split("\t")
        changedFiles.push({
          path: filepath,
          added: added === "-" ? 0 : parseInt(added, 10),
          removed: removed === "-" ? 0 : parseInt(removed, 10),
          status: "modified",
        })
      }
    }

    const untrackedOutput = await $`git -c core.quotepath=false ls-files --others --exclude-standard`
      .cwd(Instance.directory)
      .quiet()
      .nothrow()
      .text()

    if (untrackedOutput.trim()) {
      const untrackedFiles = untrackedOutput.trim().split("\n")
      for (const filepath of untrackedFiles) {
        try {
          const content = await Filesystem.readText(path.join(Instance.directory, filepath))
          const lines = content.split("\n").length
          changedFiles.push({
            path: filepath,
            added: lines,
            removed: 0,
            status: "added",
          })
        } catch {
          continue
        }
      }
    }

    // Get deleted files
    const deletedOutput = await $`git -c core.quotepath=false diff --name-only --diff-filter=D HEAD`
      .cwd(Instance.directory)
      .quiet()
      .nothrow()
      .text()

    if (deletedOutput.trim()) {
      const deletedFiles = deletedOutput.trim().split("\n")
      for (const filepath of deletedFiles) {
        changedFiles.push({
          path: filepath,
          added: 0,
          removed: 0, // Could get original line count but would require another git command
          status: "deleted",
        })
      }
    }

    return changedFiles.map((x) => {
      const full = path.isAbsolute(x.path) ? x.path : path.join(Instance.directory, x.path)
      return {
        ...x,
        path: path.relative(Instance.directory, full),
      }
    })
  }

  export async function read(file: string): Promise<Content> {
    using _ = log.time("read", { file })
    const project = Instance.project
    const full = path.join(Instance.directory, file)

    // TODO: Filesystem.contains is lexical only - symlinks inside the project can escape.
    // TODO: On Windows, cross-drive paths bypass this check. Consider realpath canonicalization.
    if (!Instance.containsPath(full)) {
      throw new Error(`Access denied: path escapes project directory`)
    }

    // Fast path: check extension before any filesystem operations
    if (isImageByExtension(file)) {
      if (await Filesystem.exists(full)) {
        const buffer = await Filesystem.readBytes(full).catch(() => Buffer.from([]))
        const content = buffer.toString("base64")
        const mimeType = getImageMimeType(file)
        return { type: "text", content, mimeType, encoding: "base64" }
      }
      return { type: "text", content: "" }
    }

    const text = isTextByExtension(file) || isTextByName(file)

    if (isBinaryByExtension(file) && !text) {
      return { type: "binary", content: "" }
    }

    if (!(await Filesystem.exists(full))) {
      return { type: "text", content: "" }
    }

    const mimeType = Filesystem.mimeType(full)
    const encode = text ? false : await shouldEncode(mimeType)

    if (encode && !isImage(mimeType)) {
      return { type: "binary", content: "", mimeType }
    }

    if (encode) {
      const buffer = await Filesystem.readBytes(full).catch(() => Buffer.from([]))
      const content = buffer.toString("base64")
      return { type: "text", content, mimeType, encoding: "base64" }
    }

    const content = (await Filesystem.readText(full).catch(() => "")).trim()

    if (project.vcs === "git") {
      let diff = await $`git diff ${file}`.cwd(Instance.directory).quiet().nothrow().text()
      if (!diff.trim()) diff = await $`git diff --staged ${file}`.cwd(Instance.directory).quiet().nothrow().text()
      if (diff.trim()) {
        const original = await $`git show HEAD:${file}`.cwd(Instance.directory).quiet().nothrow().text()
        const patch = structuredPatch(file, file, original, content, "old", "new", {
          context: Infinity,
          ignoreWhitespace: true,
        })
        const diff = formatPatch(patch)
        return { type: "text", content, patch, diff }
      }
    }
    return { type: "text", content }
  }

  export async function list(dir?: string) {
    const exclude = [".git", ".DS_Store"]
    const project = Instance.project
    let ignored = (_: string) => false
    if (project.vcs === "git") {
      const ig = ignore()
      const gitignorePath = path.join(Instance.worktree, ".gitignore")
      if (await Filesystem.exists(gitignorePath)) {
        ig.add(await Filesystem.readText(gitignorePath))
      }
      const ignorePath = path.join(Instance.worktree, ".ignore")
      if (await Filesystem.exists(ignorePath)) {
        ig.add(await Filesystem.readText(ignorePath))
      }
      ignored = ig.ignores.bind(ig)
    }
    const resolved = dir ? path.join(Instance.directory, dir) : Instance.directory

    // TODO: Filesystem.contains is lexical only - symlinks inside the project can escape.
    // TODO: On Windows, cross-drive paths bypass this check. Consider realpath canonicalization.
    if (!Instance.containsPath(resolved)) {
      throw new Error(`Access denied: path escapes project directory`)
    }

    const nodes: Node[] = []
    for (const entry of await fs.promises
      .readdir(resolved, {
        withFileTypes: true,
      })
      .catch(() => [])) {
      if (exclude.includes(entry.name)) continue
      const fullPath = path.join(resolved, entry.name)
      const relativePath = path.relative(Instance.directory, fullPath)
      const type = entry.isDirectory() ? "directory" : "file"
      nodes.push({
        name: entry.name,
        path: relativePath,
        absolute: fullPath,
        type,
        ignored: ignored(type === "directory" ? relativePath + "/" : relativePath),
      })
    }
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }

  function externalDirectory(pattern: string) {
    if (!pattern.endsWith("/*") && !pattern.endsWith("\\*")) return
    const result = pattern.slice(0, -2)
    if (!path.isAbsolute(result)) return
    if (result.includes("*") || result.includes("?")) return
    return path.normalize(result)
  }

  function traversalOnly(input: string) {
    const parts = input.replaceAll("\\", "/").split("/").filter(Boolean)
    if (parts.length === 0) return false
    return parts.every((part) => part === "..")
  }

  async function external(sessionID?: string) {
    if (!sessionID) return empty()

    const session = await Session.get(sessionID).catch(() => undefined)
    if (!session?.permission) {
      externalCache.delete(sessionID)
      return empty()
    }

    const dirs = Array.from(
      new Set(
        session.permission
          .filter((rule) => rule.permission === "external_directory" && rule.action === "allow")
          .map((rule) => externalDirectory(rule.pattern))
          .filter((rule): rule is string => Boolean(rule)),
      ),
    ).toSorted()

    const key = dirs.join("\0")
    const now = Date.now()
    const cached = externalCache.get(sessionID)
    if (cached && cached.key === key && now - cached.time < EXTERNAL_CACHE_TTL) return cached.value

    if (!dirs.length) {
      const value = empty()
      externalCache.set(sessionID, { key, time: now, value })
      return value
    }

    const files: string[] = []
    const folders = new Set<string>()

    for (const dir of dirs) {
      const stat = await Bun.file(dir)
        .stat()
        .catch(() => undefined)
      if (!stat?.isDirectory()) continue

      const root = path.relative(Instance.directory, dir)
      if (root && root !== "." && !traversalOnly(root)) folders.add(root + "/")

      for await (const file of Ripgrep.files({ cwd: dir })) {
        const absolute = path.join(dir, file)
        const relative = path.relative(Instance.directory, absolute)
        files.push(relative)

        let current = relative
        while (true) {
          const parent = path.dirname(current)
          if (parent === "." || parent === current || traversalOnly(parent)) break
          current = parent
          folders.add(parent + "/")
        }
      }
    }

    const value = {
      files: Array.from(new Set(files)),
      dirs: Array.from(folders),
    }
    externalCache.set(sessionID, { key, time: now, value })
    return value
  }

  export async function search(input: {
    query: string
    limit?: number
    dirs?: boolean
    type?: "file" | "directory"
    sessionID?: string
  }) {
    const query = input.query.trim()
    const limit = input.limit ?? 100
    const kind = input.type ?? (input.dirs === false ? "file" : "all")
    log.info("search", { query, kind })

    const root = await state().then((x) => x.files())
    const extra = await external(input.sessionID)
    const files = extra.files.length ? Array.from(new Set([...root.files, ...extra.files])) : root.files
    const dirs = extra.dirs.length ? Array.from(new Set([...root.dirs, ...extra.dirs])) : root.dirs

    const hidden = (item: string) => {
      const normalized = item.replaceAll("\\", "/").replace(/\/+$/, "")
      return normalized.split("/").some((p) => p !== "." && p !== ".." && p.startsWith(".") && p.length > 1)
    }
    const preferHidden = query.startsWith(".") || query.includes("/.")
    const sortHiddenLast = (items: string[]) => {
      if (preferHidden) return items
      const visible: string[] = []
      const hiddenItems: string[] = []
      for (const item of items) {
        const isHidden = hidden(item)
        if (isHidden) hiddenItems.push(item)
        if (!isHidden) visible.push(item)
      }
      return [...visible, ...hiddenItems]
    }
    if (!query) {
      if (kind === "file") return files.slice(0, limit)
      return sortHiddenLast(dirs.toSorted()).slice(0, limit)
    }

    const items = kind === "file" ? files : kind === "directory" ? dirs : [...files, ...dirs]

    const searchLimit = kind === "directory" && !preferHidden ? limit * 20 : limit
    const sorted = fuzzysort.go(query, items, { limit: searchLimit }).map((r) => r.target)
    const output = kind === "directory" ? sortHiddenLast(sorted).slice(0, limit) : sorted

    log.info("search", { query, kind, results: output.length })
    return output
  }
}

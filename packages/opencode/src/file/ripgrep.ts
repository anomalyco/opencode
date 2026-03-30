// Ripgrep utility functions
import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { lazy } from "../util/lazy"

import { Filesystem } from "../util/filesystem"
import { Process } from "../util/process"
import { which } from "../util/which"
import { text } from "node:stream/consumers"
import { Glob } from "../util/glob"

import { ZipReader, BlobReader, BlobWriter } from "@zip.js/zip.js"
import { Log } from "@/util/log"

export namespace Ripgrep {
  const log = Log.create({ service: "ripgrep" })
  const Stats = z.object({
    elapsed: z.object({
      secs: z.number(),
      nanos: z.number(),
      human: z.string(),
    }),
    searches: z.number(),
    searches_with_match: z.number(),
    bytes_searched: z.number(),
    bytes_printed: z.number(),
    matched_lines: z.number(),
    matches: z.number(),
  })

  const Begin = z.object({
    type: z.literal("begin"),
    data: z.object({
      path: z.object({
        text: z.string(),
      }),
    }),
  })

  export const Match = z.object({
    type: z.literal("match"),
    data: z.object({
      path: z.object({
        text: z.string(),
      }),
      lines: z.object({
        text: z.string(),
      }),
      line_number: z.number(),
      absolute_offset: z.number(),
      submatches: z.array(
        z.object({
          match: z.object({
            text: z.string(),
          }),
          start: z.number(),
          end: z.number(),
        }),
      ),
    }),
  })

  const End = z.object({
    type: z.literal("end"),
    data: z.object({
      path: z.object({
        text: z.string(),
      }),
      binary_offset: z.number().nullable(),
      stats: Stats,
    }),
  })

  const Summary = z.object({
    type: z.literal("summary"),
    data: z.object({
      elapsed_total: z.object({
        human: z.string(),
        nanos: z.number(),
        secs: z.number(),
      }),
      stats: Stats,
    }),
  })

  const Result = z.union([Begin, Match, End, Summary])

  export type Result = z.infer<typeof Result>
  export type Match = z.infer<typeof Match>
  export type Begin = z.infer<typeof Begin>
  export type End = z.infer<typeof End>
  export type Summary = z.infer<typeof Summary>
  const PLATFORM = {
    "arm64-darwin": { platform: "aarch64-apple-darwin", extension: "tar.gz" },
    "arm64-linux": {
      platform: "aarch64-unknown-linux-gnu",
      extension: "tar.gz",
    },
    "x64-darwin": { platform: "x86_64-apple-darwin", extension: "tar.gz" },
    "x64-linux": { platform: "x86_64-unknown-linux-musl", extension: "tar.gz" },
    "arm64-win32": { platform: "aarch64-pc-windows-msvc", extension: "zip" },
    "x64-win32": { platform: "x86_64-pc-windows-msvc", extension: "zip" },
  } as const

  export const ExtractionFailedError = NamedError.create(
    "RipgrepExtractionFailedError",
    z.object({
      filepath: z.string(),
      stderr: z.string(),
    }),
  )

  export const UnsupportedPlatformError = NamedError.create(
    "RipgrepUnsupportedPlatformError",
    z.object({
      platform: z.string(),
    }),
  )

  export const DownloadFailedError = NamedError.create(
    "RipgrepDownloadFailedError",
    z.object({
      url: z.string(),
      status: z.number(),
    }),
  )

  type Local = {
    filepath?: string
  }

  async function probe(): Promise<Local> {
    const system = which("rg")
    if (system) {
      const stat = await fs.stat(system).catch(() => undefined)
      if (stat?.isFile()) return { filepath: system }
      log.warn("bun.which returned invalid rg path", { filepath: system })
    }

    const filepath = path.join(Global.Path.bin, "rg" + (process.platform === "win32" ? ".exe" : ""))
    if (await Filesystem.exists(filepath)) return { filepath }
    return {}
  }

  const state = lazy(async (): Promise<Local> => {
    const local = await probe()
    if (local.filepath) return local

    const filepath = path.join(Global.Path.bin, "rg" + (process.platform === "win32" ? ".exe" : ""))

    if (!(await Filesystem.exists(filepath))) {
      const platformKey = `${process.arch}-${process.platform}` as keyof typeof PLATFORM
      const config = PLATFORM[platformKey]
      if (!config) throw new UnsupportedPlatformError({ platform: platformKey })

      const version = "14.1.1"
      const filename = `ripgrep-${version}-${config.platform}.${config.extension}`
      const url = `https://github.com/BurntSushi/ripgrep/releases/download/${version}/${filename}`

      const response = await fetch(url)
      if (!response.ok) throw new DownloadFailedError({ url, status: response.status })

      const arrayBuffer = await response.arrayBuffer()
      const archivePath = path.join(Global.Path.bin, filename)
      await Filesystem.write(archivePath, Buffer.from(arrayBuffer))
      if (config.extension === "tar.gz") {
        const args = ["tar", "-xzf", archivePath, "--strip-components=1"]

        if (platformKey.endsWith("-darwin")) args.push("--include=*/rg")
        if (platformKey.endsWith("-linux")) args.push("--wildcards", "*/rg")

        const proc = Process.spawn(args, {
          cwd: Global.Path.bin,
          stderr: "pipe",
          stdout: "pipe",
        })
        const exit = await proc.exited
        if (exit !== 0) {
          const stderr = proc.stderr ? await text(proc.stderr) : ""
          throw new ExtractionFailedError({
            filepath,
            stderr,
          })
        }
      }
      if (config.extension === "zip") {
        const zipFileReader = new ZipReader(new BlobReader(new Blob([arrayBuffer])))
        const entries = await zipFileReader.getEntries()
        let rgEntry: any
        for (const entry of entries) {
          if (entry.filename.endsWith("rg.exe")) {
            rgEntry = entry
            break
          }
        }

        if (!rgEntry) {
          throw new ExtractionFailedError({
            filepath: archivePath,
            stderr: "rg.exe not found in zip archive",
          })
        }

        const rgBlob = await rgEntry.getData(new BlobWriter())
        if (!rgBlob) {
          throw new ExtractionFailedError({
            filepath: archivePath,
            stderr: "Failed to extract rg.exe from zip archive",
          })
        }
        await Filesystem.write(filepath, Buffer.from(await rgBlob.arrayBuffer()))
        await zipFileReader.close()
      }
      await fs.unlink(archivePath)
      if (!platformKey.endsWith("-win32")) await fs.chmod(filepath, 0o755)
    }

    return {
      filepath,
    }
  })

  export async function filepath() {
    const { filepath } = await state()
    if (!filepath) throw new Error("ripgrep not available")
    return filepath
  }

  async function available() {
    return probe().catch((err) => {
      log.warn("ripgrep unavailable, using local fallback", { error: err instanceof Error ? err.message : String(err) })
      return {} satisfies Local
    })
  }

  async function* walk(input: {
    cwd: string
    dir: string
    glob?: string[]
    hidden?: boolean
    follow?: boolean
    maxDepth?: number
    depth?: number
    signal?: AbortSignal
  }): AsyncGenerator<string> {
    input.signal?.throwIfAborted()
    const list = await fs.readdir(input.dir, { withFileTypes: true }).catch(() => [] as fs.Dirent[])
    for (const entry of list) {
      input.signal?.throwIfAborted()
      if (entry.name === ".git") continue
      if (input.hidden === false && entry.name.startsWith(".")) continue

      const abs = path.join(input.dir, entry.name)
      const rel = path.relative(input.cwd, abs)
      const key = rel.replaceAll("\\", "/")
      const next = input.depth ?? 0

      if (entry.isSymbolicLink()) {
        if (!input.follow) continue
        const stat = await fs.stat(abs).catch(() => undefined)
        if (!stat) continue
        if (stat.isDirectory()) {
          if (input.maxDepth !== undefined && next >= input.maxDepth) continue
          yield* walk({
            ...input,
            dir: abs,
            depth: next + 1,
          })
          continue
        }
      }

      if (entry.isDirectory()) {
        if (input.maxDepth !== undefined && next >= input.maxDepth) continue
        yield* walk({
          ...input,
          dir: abs,
          depth: next + 1,
        })
        continue
      }

      if (input.glob && !input.glob.some((glob) => Glob.match(glob, key))) continue
      yield rel
    }
  }

  function localFiles(input: {
    cwd: string
    glob?: string[]
    hidden?: boolean
    follow?: boolean
    maxDepth?: number
    signal?: AbortSignal
  }) {
    return walk({
      ...input,
      dir: input.cwd,
      depth: 0,
    })
  }

  async function localSearch(input: {
    cwd: string
    pattern: string
    glob?: string[]
    limit?: number
    follow?: boolean
  }) {
    const rx = new RegExp(input.pattern, "g")
    const out: Match["data"][] = []

    for await (const file of localFiles({
      cwd: input.cwd,
      glob: input.glob,
      hidden: true,
      follow: input.follow,
    })) {
      if (input.limit && out.length >= input.limit) break
      const abs = path.join(input.cwd, file)
      const text = await fs.readFile(abs, "utf8").catch(() => undefined)
      if (text === undefined) continue

      const lines = text.split(/\r?\n/)
      let offset = 0
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line) {
          offset += 1
          continue
        }

        rx.lastIndex = 0
        const parts = Array.from(line.matchAll(rx))
        if (!parts.length) {
          offset += line.length + 1
          continue
        }

        out.push({
          path: { text: file },
          lines: { text: line },
          line_number: i + 1,
          absolute_offset: offset,
          submatches: parts.map((match) => ({
            match: { text: match[0] },
            start: match.index ?? 0,
            end: (match.index ?? 0) + match[0].length,
          })),
        })
        if (input.limit && out.length >= input.limit) break
        offset += line.length + 1
      }
    }

    return out
  }

  export async function* files(input: {
    cwd: string
    glob?: string[]
    hidden?: boolean
    follow?: boolean
    maxDepth?: number
    signal?: AbortSignal
  }) {
    input.signal?.throwIfAborted()

    const local = await available()
    if (!local.filepath) {
      yield* localFiles(input)
      return
    }

    const args = [local.filepath, "--files", "--glob=!.git/*"]
    if (input.follow) args.push("--follow")
    if (input.hidden !== false) args.push("--hidden")
    if (input.maxDepth !== undefined) args.push(`--max-depth=${input.maxDepth}`)
    if (input.glob) {
      for (const g of input.glob) {
        args.push(`--glob=${g}`)
      }
    }

    // Guard against invalid cwd to provide a consistent ENOENT error.
    if (!(await fs.stat(input.cwd).catch(() => undefined))?.isDirectory()) {
      throw Object.assign(new Error(`No such file or directory: '${input.cwd}'`), {
        code: "ENOENT",
        errno: -2,
        path: input.cwd,
      })
    }

    const proc = Process.spawn(args, {
      cwd: input.cwd,
      stdout: "pipe",
      stderr: "ignore",
      abort: input.signal,
    })

    if (!proc.stdout) {
      throw new Error("Process output not available")
    }

    let buffer = ""
    const stream = proc.stdout as AsyncIterable<Buffer | string>
    for await (const chunk of stream) {
      input.signal?.throwIfAborted()

      buffer += typeof chunk === "string" ? chunk : chunk.toString()
      // Handle both Unix (\n) and Windows (\r\n) line endings
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (line) yield line
      }
    }

    if (buffer) yield buffer
    await proc.exited

    input.signal?.throwIfAborted()
  }

  export async function tree(input: { cwd: string; limit?: number; signal?: AbortSignal }) {
    log.info("tree", input)
    const files = await Array.fromAsync(Ripgrep.files({ cwd: input.cwd, signal: input.signal }))
    interface Node {
      name: string
      children: Map<string, Node>
    }

    function dir(node: Node, name: string) {
      const existing = node.children.get(name)
      if (existing) return existing
      const next = { name, children: new Map() }
      node.children.set(name, next)
      return next
    }

    const root: Node = { name: "", children: new Map() }
    for (const file of files) {
      if (file.includes(".opencode")) continue
      const parts = file.split(path.sep)
      if (parts.length < 2) continue
      let node = root
      for (const part of parts.slice(0, -1)) {
        node = dir(node, part)
      }
    }

    function count(node: Node): number {
      let total = 0
      for (const child of node.children.values()) {
        total += 1 + count(child)
      }
      return total
    }

    const total = count(root)
    const limit = input.limit ?? total
    const lines: string[] = []
    const queue: { node: Node; path: string }[] = []
    for (const child of Array.from(root.children.values()).sort((a, b) => a.name.localeCompare(b.name))) {
      queue.push({ node: child, path: child.name })
    }

    let used = 0
    for (let i = 0; i < queue.length && used < limit; i++) {
      const { node, path } = queue[i]
      lines.push(path)
      used++
      for (const child of Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name))) {
        queue.push({ node: child, path: `${path}/${child.name}` })
      }
    }

    if (total > used) lines.push(`[${total - used} truncated]`)

    return lines.join("\n")
  }

  export async function search(input: {
    cwd: string
    pattern: string
    glob?: string[]
    limit?: number
    follow?: boolean
  }) {
    const local = await available()
    if (!local.filepath) return localSearch(input)

    const args = [local.filepath, "--json", "--hidden", "--glob=!.git/*"]
    if (input.follow) args.push("--follow")

    if (input.glob) {
      for (const g of input.glob) {
        args.push(`--glob=${g}`)
      }
    }

    if (input.limit) {
      args.push(`--max-count=${input.limit}`)
    }

    args.push("--")
    args.push(input.pattern)

    const result = await Process.text(args, {
      cwd: input.cwd,
      nothrow: true,
    })
    if (result.code !== 0) {
      return []
    }

    // Handle both Unix (\n) and Windows (\r\n) line endings
    const lines = result.text.trim().split(/\r?\n/).filter(Boolean)
    // Parse JSON lines from ripgrep output

    return lines
      .map((line) => JSON.parse(line))
      .map((parsed) => Result.parse(parsed))
      .filter((r) => r.type === "match")
      .map((r) => r.data)
  }
}

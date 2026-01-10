// Ripgrep utility functions
import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { lazy } from "../util/lazy"
import { $ } from "bun"

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

  const state = lazy(async () => {
    let filepath = Bun.which("rg")
    if (filepath) return { filepath }
    filepath = path.join(Global.Path.bin, "rg" + (process.platform === "win32" ? ".exe" : ""))

    const file = Bun.file(filepath)
    if (!(await file.exists())) {
      const platformKey = `${process.arch}-${process.platform}` as keyof typeof PLATFORM
      const config = PLATFORM[platformKey]
      if (!config) throw new UnsupportedPlatformError({ platform: platformKey })

      const version = "14.1.1"
      const filename = `ripgrep-${version}-${config.platform}.${config.extension}`
      const url = `https://github.com/BurntSushi/ripgrep/releases/download/${version}/${filename}`

      const response = await fetch(url)
      if (!response.ok) throw new DownloadFailedError({ url, status: response.status })

      const buffer = await response.arrayBuffer()
      const archivePath = path.join(Global.Path.bin, filename)
      await Bun.write(archivePath, buffer)
      if (config.extension === "tar.gz") {
        const args = ["tar", "-xzf", archivePath, "--strip-components=1"]

        if (platformKey.endsWith("-darwin")) args.push("--include=*/rg")
        if (platformKey.endsWith("-linux")) args.push("--wildcards", "*/rg")

        const proc = Bun.spawn(args, {
          cwd: Global.Path.bin,
          stderr: "pipe",
          stdout: "pipe",
        })
        await proc.exited
        if (proc.exitCode !== 0)
          throw new ExtractionFailedError({
            filepath,
            stderr: await Bun.readableStreamToText(proc.stderr),
          })
      }
      if (config.extension === "zip") {
        if (config.extension === "zip") {
          const zipFileReader = new ZipReader(new BlobReader(new Blob([await Bun.file(archivePath).arrayBuffer()])))
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
          await Bun.write(filepath, await rgBlob.arrayBuffer())
          await zipFileReader.close()
        }
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
    return filepath
  }

  export async function* files(input: {
    cwd: string
    glob?: string[]
    hidden?: boolean
    follow?: boolean
    maxDepth?: number
  }) {
    const args = [await filepath(), "--files", "--glob=!.git/*"]
    if (input.follow !== false) args.push("--follow")
    if (input.hidden !== false) args.push("--hidden")
    if (input.maxDepth !== undefined) args.push(`--max-depth=${input.maxDepth}`)
    if (input.glob) {
      for (const g of input.glob) {
        args.push(`--glob=${g}`)
      }
    }

    // Bun.spawn should throw this, but it incorrectly reports that the executable does not exist.
    // See https://github.com/oven-sh/bun/issues/24012
    if (!(await fs.stat(input.cwd).catch(() => undefined))?.isDirectory()) {
      throw Object.assign(new Error(`No such file or directory: '${input.cwd}'`), {
        code: "ENOENT",
        errno: -2,
        path: input.cwd,
      })
    }

    const proc = Bun.spawn(args, {
      cwd: input.cwd,
      stdout: "pipe",
      stderr: "ignore",
      maxBuffer: 1024 * 1024 * 20,
    })

    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        // Handle both Unix (\n) and Windows (\r\n) line endings
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (line) yield line
        }
      }

      if (buffer) yield buffer
    } finally {
      reader.releaseLock()
      await proc.exited
    }
  }

  export async function tree(input: { cwd: string; limit?: number }) {
    log.info("tree", input)
    const files = await Array.fromAsync(Ripgrep.files({ cwd: input.cwd }))
    interface Node {
      path: string[]
      children: Node[]
    }

    function getPath(node: Node, parts: string[], create: boolean) {
      if (parts.length === 0) return node
      let current = node
      for (const part of parts) {
        let existing = current.children.find((x) => x.path.at(-1) === part)
        if (!existing) {
          if (!create) return
          existing = {
            path: current.path.concat(part),
            children: [],
          }
          current.children.push(existing)
        }
        current = existing
      }
      return current
    }

    const root: Node = {
      path: [],
      children: [],
    }
    for (const file of files) {
      if (file.includes(".opencode")) continue
      const parts = file.split(path.sep)
      getPath(root, parts, true)
    }

    function sort(node: Node) {
      node.children.sort((a, b) => {
        if (!a.children.length && b.children.length) return 1
        if (!b.children.length && a.children.length) return -1
        return a.path.at(-1)!.localeCompare(b.path.at(-1)!)
      })
      for (const child of node.children) {
        sort(child)
      }
    }
    sort(root)

    let current = [root]
    const result: Node = {
      path: [],
      children: [],
    }

    let processed = 0
    const limit = input.limit ?? 50
    while (current.length > 0) {
      const next = []
      for (const node of current) {
        if (node.children.length) next.push(...node.children)
      }
      const max = Math.max(...current.map((x) => x.children.length))
      for (let i = 0; i < max && processed < limit; i++) {
        for (const node of current) {
          const child = node.children[i]
          if (!child) continue
          getPath(result, child.path, true)
          processed++
          if (processed >= limit) break
        }
      }
      if (processed >= limit) {
        for (const node of [...current, ...next]) {
          const compare = getPath(result, node.path, false)
          if (!compare) continue
          if (compare?.children.length !== node.children.length) {
            const diff = node.children.length - compare.children.length
            compare.children.push({
              path: compare.path.concat(`[${diff} truncated]`),
              children: [],
            })
          }
        }
        break
      }
      current = next
    }

    const lines: string[] = []

    function render(node: Node, depth: number) {
      const indent = "\t".repeat(depth)
      lines.push(indent + node.path.at(-1) + (node.children.length ? "/" : ""))
      for (const child of node.children) {
        render(child, depth + 1)
      }
    }
    result.children.map((x) => render(x, 0))

    return lines.join("\n")
  }

  export async function search(input: {
    cwd: string
    pattern: string
    glob?: string[]
    limit?: number
    follow?: boolean
  }) {
    const args = [`${await filepath()}`, "--json", "--hidden", "--glob='!.git/*'"]
    if (input.follow !== false) args.push("--follow")

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

    const command = args.join(" ")
    const result = await $`${{ raw: command }}`.cwd(input.cwd).quiet().nothrow()
    if (result.exitCode !== 0) {
      return []
    }

    // Handle both Unix (\n) and Windows (\r\n) line endings
    const lines = result.text().trim().split(/\r?\n/).filter(Boolean)
    // Parse JSON lines from ripgrep output

    return lines
      .map((line) => JSON.parse(line))
      .map((parsed) => Result.parse(parsed))
      .filter((r) => r.type === "match")
      .map((r) => r.data)
  }
}

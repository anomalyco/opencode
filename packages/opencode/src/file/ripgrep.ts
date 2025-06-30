import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import { z } from "zod"
import { NamedError } from "../util/error"
import { lazy } from "../util/lazy"
import { $ } from "bun"
import { Fzf } from "./fzf"

export namespace Ripgrep {
  const PLATFORM = {
    darwin: { platform: "apple-darwin", extension: "tar.gz" },
    linux: { platform: "unknown-linux-musl", extension: "tar.gz" },
    win32: { platform: "pc-windows-msvc", extension: "zip" },
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
    filepath = path.join(
      Global.Path.bin,
      "rg" + (process.platform === "win32" ? ".exe" : ""),
    )

    const file = Bun.file(filepath)
    if (!(await file.exists())) {
      const archMap = { x64: "x86_64", arm64: "aarch64" } as const
      const arch = archMap[process.arch as keyof typeof archMap] ?? process.arch

      const config = PLATFORM[process.platform as keyof typeof PLATFORM]
      if (!config)
        throw new UnsupportedPlatformError({ platform: process.platform })

      const version = "14.1.1"
      const filename = `ripgrep-${version}-${arch}-${config.platform}.${config.extension}`
      const url = `https://github.com/BurntSushi/ripgrep/releases/download/${version}/${filename}`

      const response = await fetch(url)
      if (!response.ok)
        throw new DownloadFailedError({ url, status: response.status })

      const buffer = await response.arrayBuffer()
      const archivePath = path.join(Global.Path.bin, filename)
      await Bun.write(archivePath, buffer)
      if (config.extension === "tar.gz") {
        const args = ["tar", "-xzf", archivePath, "--strip-components=1"]

        if (process.platform === "darwin") args.push("--include=*/rg")
        if (process.platform === "linux") args.push("--wildcards", "*/rg")

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
        const proc = Bun.spawn(
          ["unzip", "-j", archivePath, "*/rg.exe", "-d", Global.Path.bin],
          {
            cwd: Global.Path.bin,
            stderr: "pipe",
            stdout: "ignore",
          },
        )
        await proc.exited
        if (proc.exitCode !== 0)
          throw new ExtractionFailedError({
            filepath: archivePath,
            stderr: await Bun.readableStreamToText(proc.stderr),
          })
      }
      await fs.unlink(archivePath)
      if (process.platform !== "win32") await fs.chmod(filepath, 0o755)
    }

    return {
      filepath,
    }
  })

  export async function filepath() {
    const { filepath } = await state()
    return filepath
  }

  export async function files(input: {
    cwd: string
    query?: string
    glob?: string
    limit?: number
  }) {
    const commands = [
      `${await filepath()} --files --hidden --glob='!.git/*' ${input.glob ? `--glob='${input.glob}'` : ``}`,
    ]
    if (input.query)
      commands.push(`${await Fzf.filepath()} --filter=${input.query}`)
    if (input.limit) commands.push(`head -n ${input.limit}`)
    const joined = commands.join(" | ")
    const result = await $`${{ raw: joined }}`.cwd(input.cwd).nothrow().text()
    return result.split("\n").filter(Boolean)
  }

  export async function tree(input: { cwd: string; limit?: number }) {
    const files = await Ripgrep.files({ cwd: input.cwd })
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
}

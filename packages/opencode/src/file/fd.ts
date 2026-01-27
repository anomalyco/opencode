// fd (sharkdp/fd) utility functions for file/directory finding
import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { lazy } from "../util/lazy"
import { ZipReader, BlobReader, BlobWriter } from "@zip.js/zip.js"
import { Log } from "@/util/log"

export namespace Fd {
  const log = Log.create({ service: "fd" })

  const PLATFORM = {
    "arm64-darwin": { platform: "aarch64-apple-darwin", extension: "tar.gz" },
    "arm64-linux": {
      platform: "aarch64-unknown-linux-musl",
      extension: "tar.gz",
    },
    "x64-darwin": { platform: "x86_64-apple-darwin", extension: "tar.gz" },
    "x64-linux": { platform: "x86_64-unknown-linux-musl", extension: "tar.gz" },
    "x64-win32": { platform: "x86_64-pc-windows-msvc", extension: "zip" },
    "arm64-win32": { platform: "aarch64-pc-windows-msvc", extension: "zip" },
  } as const

  export const ExtractionFailedError = NamedError.create(
    "FdExtractionFailedError",
    z.object({
      filepath: z.string(),
      stderr: z.string(),
    }),
  )

  export const UnsupportedPlatformError = NamedError.create(
    "FdUnsupportedPlatformError",
    z.object({
      platform: z.string(),
    }),
  )

  export const DownloadFailedError = NamedError.create(
    "FdDownloadFailedError",
    z.object({
      url: z.string(),
      status: z.number(),
    }),
  )

  const state = lazy(async () => {
    let filepath = Bun.which("fd")
    if (filepath) return { filepath }
    filepath = path.join(Global.Path.bin, "fd" + (process.platform === "win32" ? ".exe" : ""))

    const file = Bun.file(filepath)
    if (!(await file.exists())) {
      const platformKey = `${process.arch}-${process.platform}` as keyof typeof PLATFORM
      const config = PLATFORM[platformKey]
      if (!config) throw new UnsupportedPlatformError({ platform: platformKey })

      const version = "10.3.0"
      const filename = `fd-v${version}-${config.platform}.${config.extension}`
      const url = `https://github.com/sharkdp/fd/releases/download/v${version}/${filename}`

      log.info("downloading fd", { url })
      const response = await fetch(url)
      if (!response.ok) throw new DownloadFailedError({ url, status: response.status })

      const buffer = await response.arrayBuffer()
      const archivePath = path.join(Global.Path.bin, filename)
      await Bun.write(archivePath, buffer)
      if (config.extension === "tar.gz") {
        const args = ["tar", "-xzf", archivePath, "--strip-components=1"]

        if (platformKey.endsWith("-darwin")) args.push("--include=*/fd")
        if (platformKey.endsWith("-linux")) args.push("--wildcards", "*/fd")

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
        const zipFileReader = new ZipReader(new BlobReader(new Blob([await Bun.file(archivePath).arrayBuffer()])))
        const entries = await zipFileReader.getEntries()
        let fdEntry: any
        for (const entry of entries) {
          if (entry.filename.endsWith("fd.exe")) {
            fdEntry = entry
            break
          }
        }

        if (!fdEntry) {
          throw new ExtractionFailedError({
            filepath: archivePath,
            stderr: "fd.exe not found in zip archive",
          })
        }

        const fdBlob = await fdEntry.getData(new BlobWriter())
        if (!fdBlob) {
          throw new ExtractionFailedError({
            filepath: archivePath,
            stderr: "Failed to extract fd.exe from zip archive",
          })
        }
        await Bun.write(filepath, await fdBlob.arrayBuffer())
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
    return filepath
  }

  export async function* glob(input: {
    cwd: string
    pattern: string
    hidden?: boolean
    follow?: boolean
    maxDepth?: number
  }) {
    // fd uses -g for glob patterns and searches for both files and directories by default
    // fd is recursive by default, so *.ts matches **/*.ts
    // For patterns with path components (containing /), we need --full-path with absolute path
    const hasPath = input.pattern.includes("/")
    const isAbsolute = input.pattern.startsWith("/")
    const pattern = hasPath && !isAbsolute ? `${input.cwd}/${input.pattern}` : input.pattern
    const args = [await filepath(), "--glob", "--exclude=.git"]
    if (hasPath) args.push("--full-path")
    args.push(pattern)
    if (input.follow !== false) args.push("--follow")
    if (input.hidden !== false) args.push("--hidden")
    if (input.maxDepth !== undefined) args.push(`--max-depth=${input.maxDepth}`)

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
}

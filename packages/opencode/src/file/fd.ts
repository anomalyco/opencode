import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Global } from "../global"
import { NamedError } from "@opencode-ai/util/error"
import { ZipReader, BlobReader, BlobWriter } from "@zip.js/zip.js"

export namespace Fd {
  const DownloadFailedError = NamedError.create(
    "FdDownloadFailedError",
    z.object({
      url: z.string(),
      status: z.number(),
    }),
  )
  const ExtractionFailedError = NamedError.create(
    "FdExtractionFailedError",
    z.object({
      filepath: z.string(),
      stderr: z.string(),
    }),
  )

  const PLATFORM = {
    "arm64-darwin": { filename: "aarch64-apple-darwin", extension: "tar.gz" },
    "arm64-win32": { filename: "aarch64-pc-windows-msvc", extension: "zip" },
    "arm64-linux": { filename: "aarch64-unknown-linux-gnu", extension: "tar.gz" },
    "x64-darwin": { filename: "x86_64-apple-darwin", extension: "tar.gz" },
    "x64-win32": { filename: "x86_64-pc-windows-gnu", extension: "zip" },
    "x64-linux": { filename: "x86_64-unknown-linux-gnu", extension: "tar.gz" },
  }

  async function downloadFd() {
    const version = "v10.3.0"
    const platformKey = `${process.arch}-${process.platform}` as keyof typeof PLATFORM
    const platform = PLATFORM[platformKey]

    const filename = `fd-${version}-${platform.filename}.${platform.extension}`
    const url = `https://github.com/sharkdp/fd/releases/download/${version}/${filename}`

    const response = await fetch(url)
    if (!response.ok) throw new DownloadFailedError({ url, status: response.status })

    const buffer = await response.arrayBuffer()
    const archivePath = path.join(Global.Path.bin, filename)
    await Bun.write(archivePath, buffer)


    if (platform.extension === "tar.gz") {
      const args = ["tar", "-xzf", archivePath, "--strip-components=1"]

      if (platformKey.endsWith("-darwin")) args.push("--include=*/fd")
      if (platformKey.endsWith("-linux")) args.push("--wildcards", "*/fd")

      const proc = Bun.spawn(args, {
        cwd: Global.Path.bin,
        stderr: "pipe",
        stdout: "pipe",
      })

      await proc.exited
      if (proc.exitCode !== 0) {
        throw new ExtractionFailedError({
          filepath: archivePath,
          stderr: await Bun.readableStreamToText(proc.stderr),
        })
      }
    }

    if (platform.extension === "zip") {
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
      await Bun.write(path.join(Global.Path.bin, "fd.exe"), await fdBlob.arrayBuffer())
      await zipFileReader.close()
    }

    await fs.unlink(archivePath)
    if (!platformKey.endsWith("-win32")) {
      await fs.chmod(path.join(Global.Path.bin, "fd"), 0o755)
    }
  }


  export async function fdExcutablePath() {
    let filepath = Bun.which("fd")
    if (filepath) return filepath

    filepath = path.join(Global.Path.bin, "fd" + (process.platform === "win32" ? ".exe" : ""))

    if (await Bun.file(filepath).exists()) {
      return filepath
    }

    await downloadFd()
    return filepath
  }

  export async function* list(input: {
    cwd: string
    follow?: boolean
    hidden?: boolean
  }) {

    const args = [await fdExcutablePath(), "--exclude", ".git"]
    if (input.follow !== false) args.push("--follow")
    if (input.hidden !== false) args.push("--hidden")


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

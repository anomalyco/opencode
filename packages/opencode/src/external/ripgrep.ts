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
}

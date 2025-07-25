import path from "path"
import fs from "fs/promises"
import { z } from "zod"
import { NamedError } from "../util/error"
import { Global } from "../global"

export namespace RipgrepInstaller {
  const RIPGREP_VERSION = "14.1.1"
  
  const PLATFORM_CONFIG = {
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

  export async function getExecutablePath(): Promise<string> {
    // Check if ripgrep is already in PATH
    const systemPath = Bun.which("rg")
    if (systemPath) return systemPath

    // Check local installation
    const localPath = path.join(Global.Path.bin, "rg" + (process.platform === "win32" ? ".exe" : ""))
    const file = Bun.file(localPath)
    
    if (await file.exists()) {
      return localPath
    }

    // Install ripgrep
    await install(localPath)
    return localPath
  }

  async function install(targetPath: string): Promise<void> {
    const platformKey = `${process.arch}-${process.platform}` as keyof typeof PLATFORM_CONFIG
    const config = PLATFORM_CONFIG[platformKey]
    
    if (!config) {
      throw new UnsupportedPlatformError({ platform: platformKey })
    }

    const archivePath = await download(config)
    await extract(config, archivePath, targetPath)
    await fs.unlink(archivePath)

    if (!platformKey.endsWith("-win32")) {
      await fs.chmod(targetPath, 0o755)
    }
  }

  async function download(config: typeof PLATFORM_CONFIG[keyof typeof PLATFORM_CONFIG]): Promise<string> {
    const filename = `ripgrep-${RIPGREP_VERSION}-${config.platform}.${config.extension}`
    const url = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${filename}`

    const response = await fetch(url)
    if (!response.ok) {
      throw new DownloadFailedError({ url, status: response.status })
    }

    const buffer = await response.arrayBuffer()
    const archivePath = path.join(Global.Path.bin, filename)
    await Bun.write(archivePath, buffer)

    return archivePath
  }

  async function extract(
    config: typeof PLATFORM_CONFIG[keyof typeof PLATFORM_CONFIG],
    archivePath: string,
    targetPath: string
  ): Promise<void> {
    const platformKey = `${process.arch}-${process.platform}`

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
      if (proc.exitCode !== 0) {
        throw new ExtractionFailedError({
          filepath: targetPath,
          stderr: await Bun.readableStreamToText(proc.stderr),
        })
      }
    } else if (config.extension === "zip") {
      const proc = Bun.spawn(["unzip", "-j", archivePath, "*/rg.exe", "-d", Global.Path.bin], {
        cwd: Global.Path.bin,
        stderr: "pipe",
        stdout: "ignore",
      })

      await proc.exited
      if (proc.exitCode !== 0) {
        throw new ExtractionFailedError({
          filepath: archivePath,
          stderr: await Bun.readableStreamToText(proc.stderr),
        })
      }
    }
  }
}
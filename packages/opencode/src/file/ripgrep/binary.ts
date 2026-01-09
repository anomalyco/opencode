import path from "path"
import fs from "fs/promises"

import z from "zod"
import { ZipReader, BlobReader, BlobWriter } from "@zip.js/zip.js"

import { NamedError } from "@opencode-ai/util/error"

import { Global } from "@/global"

const RG_VERSION = "14.1.1"

const PLATFORMS = {
  "arm64-darwin": { target: "aarch64-apple-darwin", ext: "tar.gz" },
  "arm64-linux": { target: "aarch64-unknown-linux-gnu", ext: "tar.gz" },
  "x64-darwin": { target: "x86_64-apple-darwin", ext: "tar.gz" },
  "x64-linux": { target: "x86_64-unknown-linux-musl", ext: "tar.gz" },
  "x64-win32": { target: "x86_64-pc-windows-msvc", ext: "zip" },
} as const

type Platform = keyof typeof PLATFORMS

const ExtractionFailedError = NamedError.create(
  "RipgrepExtractionFailedError",
  z.object({
    filepath: z.string(),
    stderr: z.string(),
  }),
)

const UnsupportedPlatformError = NamedError.create(
  "RipgrepUnsupportedPlatformError",
  z.object({
    platform: z.string(),
  }),
)

const DownloadFailedError = NamedError.create(
  "RipgrepDownloadFailedError",
  z.object({
    url: z.string(),
    status: z.number(),
  }),
)

function getPlatformConfig() {
  const platform = `${process.arch}-${process.platform}`
  if (!(platform in PLATFORMS)) {
    throw new UnsupportedPlatformError({ platform })
  }
  return PLATFORMS[platform as Platform]
}

async function findExisting(): Promise<string | null> {
  const systemPath = Bun.which("rg")
  if (systemPath) return systemPath

  const localPath = path.join(Global.Path.bin, `rg${Global.Platform.binExt}`)
  if (await Bun.file(localPath).exists()) return localPath

  return null
}

async function downloadRg(config: { target: string; ext: string }): Promise<string> {
  const filename = `ripgrep-${RG_VERSION}-${config.target}.${config.ext}`
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/${filename}`

  const response = await fetch(url)
  if (!response.ok) throw new DownloadFailedError({ url, status: response.status })

  const archivePath = path.join(Global.Path.bin, filename)
  await Bun.write(archivePath, await response.arrayBuffer())

  return archivePath
}

async function extractPosix(archivePath: string, binRgPath: string): Promise<void> {
  const args = ["tar", "-xzf", archivePath, "--strip-components=1"]

  if (process.platform === "darwin") args.push("--include=*/rg")
  if (process.platform === "linux") args.push("--wildcards", "*/rg")

  const proc = Bun.spawn(args, {
    cwd: Global.Path.bin,
    stderr: "pipe",
    stdout: "pipe",
  })
  await proc.exited

  if (proc.exitCode !== 0) {
    throw new ExtractionFailedError({
      filepath: binRgPath,
      stderr: await new Response(proc.stderr).text(),
    })
  }

  await fs.chmod(binRgPath, 0o755)
}

async function extractWindows(archivePath: string, binRgPath: string): Promise<void> {
  const zipFileReader = new ZipReader(new BlobReader(new Blob([await Bun.file(archivePath).arrayBuffer()])))
  const entries = await zipFileReader.getEntries()

  const rgEntry = entries.find((e) => e.filename.endsWith("rg.exe"))
  if (!rgEntry) {
    throw new ExtractionFailedError({
      filepath: archivePath,
      stderr: "rg.exe not found in zip archive",
    })
  }

  const rgBlob = await rgEntry.getData!(new BlobWriter())
  if (!rgBlob) {
    throw new ExtractionFailedError({
      filepath: archivePath,
      stderr: "Failed to extract rg.exe from zip archive",
    })
  }

  await Bun.write(binRgPath, await rgBlob.arrayBuffer())
  await zipFileReader.close()
}

export async function rgBin(): Promise<string> {
  const existing = await findExisting()
  if (existing) return existing

  const rgBinPath = path.join(Global.Path.bin, `rg${Global.Platform.binExt}`)
  const config = getPlatformConfig()
  const archivePath = await downloadRg(config)

  if (Global.Platform.isWindows) {
    await extractWindows(archivePath, rgBinPath)
  } else {
    await extractPosix(archivePath, rgBinPath)
  }

  await fs.unlink(archivePath)

  return rgBinPath
}

import path from "path"
import { fileURLToPath } from "url"
import fs from "fs/promises"
import { BunProc } from "../../opencode/src/bun"
import { Filesystem } from "../../opencode/src/util/filesystem"

type WebMdnsLabelParams = {
  port: number
  hostname: string
}

export function formatForkWebMdnsLabel({ port }: WebMdnsLabelParams): string | undefined {
  return `opencode.local:${port}`
}

async function getLatestMtimeMs(startPath: string) {
  const stat = await fs.stat(startPath)
  if (!stat.isDirectory()) return stat.mtimeMs

  let latest = stat.mtimeMs
  const entries = await fs.readdir(startPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(startPath, entry.name)
    if (entry.isDirectory()) {
      const mtime = await getLatestMtimeMs(entryPath)
      if (mtime > latest) latest = mtime
      continue
    }
    if (entry.isFile()) {
      const entryStat = await fs.stat(entryPath)
      if (entryStat.mtimeMs > latest) latest = entryStat.mtimeMs
    }
  }
  return latest
}

async function getPackagedUiDir() {
  const execName = path.basename(process.execPath).toLowerCase()
  const isExecutable = execName === "opencode" || execName === "opencode.exe"
  if (!isExecutable) return { uiDir: undefined, isExecutable }
  const maybeUiDir = path.resolve(process.execPath, "..", "..", "ui")
  const hasUiDir = await Filesystem.isDir(maybeUiDir)
  return { uiDir: hasUiDir ? maybeUiDir : undefined, isExecutable }
}

async function shouldRebuildUi(appDir: string, distDir: string) {
  const hasDistDir = await Filesystem.isDir(distDir)
  if (!hasDistDir) return true

  const srcDir = path.join(appDir, "src")
  const indexHtml = path.join(appDir, "index.html")
  const viteConfig = path.join(appDir, "vite.config.ts")
  const sourceLatest = await Promise.all([
    getLatestMtimeMs(srcDir),
    getLatestMtimeMs(indexHtml),
    getLatestMtimeMs(viteConfig),
  ]).then((items) => Math.max(...items))
  const distLatest = await getLatestMtimeMs(distDir)
  return sourceLatest > distLatest
}

async function resolveLocalAppDir() {
  const candidates = [
    fileURLToPath(new URL("../../app", import.meta.url)),
    fileURLToPath(new URL("../../../packages/app", import.meta.url)),
    fileURLToPath(new URL("../../../../app", import.meta.url)),
  ]

  for (const candidate of candidates) {
    if (await Filesystem.isDir(candidate)) return candidate
  }

  throw new Error(`Local web app directory not found. Checked: ${candidates.join(", ")}`)
}

export async function resolveForkWebUiDir(): Promise<string | undefined> {
  const packaged = await getPackagedUiDir()
  if (packaged.uiDir) return packaged.uiDir

  const appDir = await resolveLocalAppDir()
  const distDir = path.join(appDir, "dist")

  const rebuild = await shouldRebuildUi(appDir, distDir)
  if (rebuild) {
    try {
      const isDevBuild = !packaged.isExecutable && process.env.NODE_ENV !== "production"
      await BunProc.run(["run", "build"], {
        cwd: appDir,
        env: isDevBuild
          ? {
              VITE_SOURCEMAP: "true",
              VITE_MINIFY: "false",
            }
          : undefined,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to build local web UI: ${message}`)
    }
  }

  const hasDistDir = await Filesystem.isDir(distDir)
  if (!hasDistDir) throw new Error(`Expected build output directory not found at ${distDir}`)
  return distDir
}

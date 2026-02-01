import { Server } from "../../server/server"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "../../flag/flag"
import open from "open"
import { networkInterfaces } from "os"
import path from "path"
import { fileURLToPath } from "url"
import { BunProc } from "../../bun"
import { Filesystem } from "../../util/filesystem"
import fs from "fs/promises"

function getNetworkIPs() {
  const nets = networkInterfaces()
  const results: string[] = []

  for (const name of Object.keys(nets)) {
    const net = nets[name]
    if (!net) continue

    for (const netInfo of net) {
      // Skip internal and non-IPv4 addresses
      if (netInfo.internal || netInfo.family !== "IPv4") continue

      // Skip Docker bridge networks (typically 172.x.x.x)
      if (netInfo.address.startsWith("172.")) continue

      results.push(netInfo.address)
    }
  }

  return results
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

async function resolveLocalWebUiDir() {
  const packaged = await getPackagedUiDir()
  if (packaged.uiDir) return packaged.uiDir

  const appDir = fileURLToPath(new URL("../../../../app", import.meta.url))
  const distDir = path.join(appDir, "dist")
  const hasAppDir = await Filesystem.isDir(appDir)
  if (!hasAppDir) {
    throw new Error(`Local web app directory not found at ${appDir}`)
  }

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

export const WebCommand = cmd({
  command: "web",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "start opencode server and open web interface",
  handler: async (args) => {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!  " + "OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = await resolveNetworkOptions(args)
    const uiDir = await resolveLocalWebUiDir()
    const server = await Server.listen({ ...opts, uiDir })
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()

    if (opts.hostname === "0.0.0.0") {
      // Show localhost for local access
      const localhostUrl = `http://localhost:${server.port}`
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Local access:      ", UI.Style.TEXT_NORMAL, localhostUrl)

      // Show network IPs for remote access
      const networkIPs = getNetworkIPs()
      if (networkIPs.length > 0) {
        for (const ip of networkIPs) {
          UI.println(
            UI.Style.TEXT_INFO_BOLD + "  Network access:    ",
            UI.Style.TEXT_NORMAL,
            `http://${ip}:${server.port}`,
          )
        }
      }

      if (opts.mdns) {
        UI.println(
          UI.Style.TEXT_INFO_BOLD + "  mDNS:              ",
          UI.Style.TEXT_NORMAL,
          `opencode.local:${server.port}`,
        )
      }

      // Open localhost in browser
      open(localhostUrl.toString()).catch(() => {})
    } else {
      const displayUrl = server.url.toString()
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Web interface:    ", UI.Style.TEXT_NORMAL, displayUrl)
      open(displayUrl).catch(() => {})
    }

    await new Promise(() => {})
    await server.stop()
  },
})

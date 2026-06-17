export * as RtkBinary from "./binary"

import fs from "fs/promises"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Archive } from "@/util/archive"
import { Process } from "@/util/process"
import { which } from "@opencode-ai/core/util/which"

const REPO = "rtk-ai/rtk"
export const DEFAULT_VERSION = "v0.42.4"

export function version() {
  return process.env.OPENCODE_RTK_VERSION ?? process.env.RTK_VERSION ?? DEFAULT_VERSION
}

export function disabled() {
  return process.env.RTK_DISABLED === "1" || process.env.OPENCODE_DISABLE_RTK === "1"
}

export function executableName() {
  return process.platform === "win32" ? "rtk.exe" : "rtk"
}

export function bundledPath() {
  return path.join(path.dirname(process.execPath), executableName())
}

export function managedPath() {
  return path.join(Global.Path.bin, executableName())
}

export function target(input?: { os?: string; arch?: string; abi?: string }) {
  const os = input?.os ?? process.platform
  const arch = input?.arch ?? process.arch
  if (os === "darwin") return `${arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`
  if (os === "win32") return `${arch === "arm64" ? "aarch64" : "x86_64"}-pc-windows-msvc`
  if (arch === "arm64") return "aarch64-unknown-linux-gnu"
  return input?.abi === "musl" ? "x86_64-unknown-linux-musl" : "x86_64-unknown-linux-musl"
}

export function archiveName(input?: { os?: string; arch?: string; abi?: string }) {
  const triple = target(input)
  if ((input?.os ?? process.platform) === "win32") return `rtk-${triple}.zip`
  return `rtk-${triple}.tar.gz`
}

export function downloadUrl(input?: { os?: string; arch?: string; abi?: string; release?: string }) {
  const release = input?.release ?? version()
  return `https://github.com/${REPO}/releases/download/${release}/${archiveName(input)}`
}

async function exists(file: string) {
  return fs
    .stat(file)
    .then(() => true)
    .catch(() => false)
}

export async function resolve() {
  if (await exists(bundledPath())) return bundledPath()
  if (await exists(managedPath())) return managedPath()
  const found = await which(executableName())
  if (found) return found
  return undefined
}

export async function install(input?: { os?: string; arch?: string; abi?: string; release?: string; dest?: string }) {
  const dest = input?.dest ?? managedPath()
  if (await exists(dest)) return dest

  const archive = archiveName(input)
  const url = downloadUrl(input)
  const tempDir = await fs.mkdtemp(path.join(Global.Path.tmp, "rtk-"))
  const archivePath = path.join(tempDir, archive)

  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`failed to download RTK (${response.status})`)
    const buf = Buffer.from(await response.arrayBuffer())
    if (!buf.byteLength) throw new Error("downloaded RTK archive is empty")
    await fs.writeFile(archivePath, buf)

    await fs.mkdir(path.dirname(dest), { recursive: true })
    if (archive.endsWith(".zip")) {
      await Archive.extractZip(archivePath, tempDir)
    } else {
      await Process.run(["tar", "-xzf", archivePath, "-C", tempDir], { nothrow: false })
    }

    const extracted = path.join(tempDir, process.platform === "win32" ? "rtk.exe" : "rtk")
    if (!(await exists(extracted))) throw new Error("RTK archive did not contain the rtk binary")
    await fs.rename(extracted, dest)
    if (process.platform !== "win32") await fs.chmod(dest, 0o755)
    return dest
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function ensure(input?: { os?: string; arch?: string; abi?: string }) {
  const resolved = await resolve()
  if (resolved) return resolved
  return install(input)
}

export async function rewrite(command: string, binary?: string) {
  if (disabled()) return command
  const rtk = binary ?? (await ensure())
  if (!rtk) return command
  const result = await Process.run([rtk, "rewrite", command], { nothrow: true })
  const rewritten = result.stdout.trim()
  if (!rewritten || rewritten === command) return command
  return rewritten
}

export function isExternalPlugin(spec: string) {
  const normalized = spec.toLowerCase()
  if (!normalized.includes("rtk")) return false
  return (
    normalized.includes("plugins/rtk") ||
    normalized.endsWith("/rtk") ||
    normalized.endsWith("/rtk.ts") ||
    normalized.endsWith("\\rtk.ts") ||
    normalized === "rtk"
  )
}

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const VERSION = "0.1.5"
const RELEASE = `https://github.com/anomalyco/opencode-pty/releases/download/v${VERSION}`
const SHA256 = {
  "aarch64-apple-darwin": "d5156e44a6783381aadbd968dbd27c1d83e7e0f1b6042c7c934e6d33541d334f",
  "aarch64-unknown-linux-gnu": "075d99ffb269cbd0846d3d404fdee93965a53cd6eaf046dbd1064785a7ce9351",
  "aarch64-unknown-linux-musl": "22fb55c944ff05fbe03e84de67333e9fd037ad4e04ffc93d8a3f0b2193c29421",
  "x86_64-apple-darwin": "773e363b5385c1bd56021e69ada95132efd615ed5b9c3734f878ad644ae22b01",
  "x86_64-unknown-linux-gnu": "d9cac2a7c09d013188f696c45ded5eb5764d308e52dd31cb2de68bf4fc675624",
  "x86_64-unknown-linux-musl": "2a176302de3d24f8ae3fbacf0b4afce7b4af3e00abd619906187a487b5e50bd6",
} as const

export type OpencodePtyAsset = {
  readonly source: string
  readonly version: string
  readonly sha256: string
}

type Target = {
  readonly platform: string
  readonly arch: string
  readonly libc?: "glibc" | "musl"
}

const pending = new Map<string, Promise<OpencodePtyAsset | undefined>>()

export function resolveOpencodePty(target: Target) {
  const rustTarget = targetName(target)
  if (!rustTarget) return Promise.resolve(undefined)
  const existing = pending.get(rustTarget)
  if (existing) return existing
  const result = acquire(rustTarget).catch((error) => {
    pending.delete(rustTarget)
    throw error
  })
  pending.set(rustTarget, result)
  return result
}

async function acquire(target: keyof typeof SHA256): Promise<OpencodePtyAsset> {
  const root = path.resolve(import.meta.dirname, "../.cache/opencode-pty", VERSION, target)
  const executable = path.join(root, "opencode-pty")
  const cached = await readFile(executable).catch(() => undefined)
  if (cached)
    return {
      source: executable,
      version: VERSION,
      sha256: createHash("sha256").update(cached).digest("hex"),
    }

  await mkdir(root, { recursive: true })
  const archiveName = `opencode-pty-${VERSION}-${target}.tar.gz`
  const response = await fetch(`${RELEASE}/${archiveName}`)
  if (!response.ok) throw new Error(`Failed to download ${archiveName}: ${response.status}`)
  const archive = new Uint8Array(await response.arrayBuffer())
  const actual = createHash("sha256").update(archive).digest("hex")
  if (actual !== SHA256[target]) throw new Error(`Checksum mismatch for ${archiveName}`)

  const temporary = await mkdtemp(path.join(os.tmpdir(), "opencode-pty-build-"))
  try {
    const archivePath = path.join(temporary, archiveName)
    await writeFile(archivePath, archive)
    run("tar", ["-xzf", archivePath, "-C", temporary])
    const source = path.join(temporary, `opencode-pty-${VERSION}-${target}`, "opencode-pty")
    const bytes = await readFile(source)
    const staged = path.join(root, `opencode-pty.${process.pid}.${crypto.randomUUID()}.tmp`)
    await writeFile(staged, bytes, { flag: "wx", mode: 0o755 })
    await rename(staged, executable).catch(async (error) => {
      await rm(staged, { force: true })
      if (!(await readFile(executable).catch(() => undefined))) throw error
    })
    const installed = await readFile(executable)
    return {
      source: executable,
      version: VERSION,
      sha256: createHash("sha256").update(installed).digest("hex"),
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function targetName(target: Target): keyof typeof SHA256 | undefined {
  const arch = target.arch === "arm64" ? "aarch64" : target.arch === "x64" ? "x86_64" : undefined
  if (!arch) return undefined
  if (target.platform === "darwin") return arch === "aarch64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  if (target.platform === "linux" && target.libc === "musl")
    return arch === "aarch64" ? "aarch64-unknown-linux-musl" : "x86_64-unknown-linux-musl"
  if (target.platform === "linux") return arch === "aarch64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu"
  return undefined
}

function run(command: string, args: readonly string[]) {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? "unknown"}`)
}

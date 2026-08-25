import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const VERSION = "0.1.4"
const RELEASE = `https://github.com/jlongster/opencode-pty/releases/download/v${VERSION}`
const SHA256 = {
  "aarch64-apple-darwin": "a91b790ee14a9d75d3dccf5ee40ded1326e5250d6882d5274b72e41e1455f8ec",
  "aarch64-unknown-linux-gnu": "53e28264e9bad28f1f2d4900f6ad5e04d034b900ff3f341cc57be73a5152d5a6",
  "aarch64-unknown-linux-musl": "00f018af1f3b2f6adf93c6d9b8866216c4266fe4e1d06e47a76bc001ae4aac46",
  "x86_64-apple-darwin": "12fe4c456ad7895994e6af7d67112b4f65871f41267a7a51341e70227052d114",
  "x86_64-unknown-linux-gnu": "9c03efc505ce86a6204b9bdfc03b30e2eb7d6edaca1c6435b0a839538d4c812f",
  "x86_64-unknown-linux-musl": "2c5803822d9d88f8d6e201d3afd28c3a861d679e8f8c88e68c54bbfa1c12214a",
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

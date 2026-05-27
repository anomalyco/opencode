/**
 * Python Bridge — manages the Python runtime for screen capture.
 *
 * Auto-creates a venv under ~/.config/yunpat-agent/runtime/ (via Global.Path.data), installs deps via pip,
 * and provides `callPythonHelper()` to invoke mac_helper.py commands.
 */
import { execFile } from "child_process"
import fs from "fs/promises"
import path from "path"
import os from "os"
import crypto from "crypto"
import { Global } from "@yunpat/core/global"

// ── Paths ────────────────────────────────────────────────────────────

const RUNTIME_DIR = path.join(Global.Path.data, "runtime")
const VENV_DIR = path.join(RUNTIME_DIR, "venv")
const REQUIREMENTS_HASH_FILE = path.join(RUNTIME_DIR, "requirements.sha256")
const PYTHON_BIN = path.join(VENV_DIR, "bin", "python3")
const PIP_BIN = path.join(VENV_DIR, "bin", "pip3")

// Source files: resolve relative to this file's location
// packages/opencode/src/computer-use/ → project root/runtime/
function getThisDir(): string {
  try {
    return __dirname
  } catch {
    // bun: use import.meta.url
    const url = new URL(import.meta.url)
    return path.dirname(decodeURIComponent(url.pathname))
  }
}
const SRC_ROOT = path.resolve(getThisDir(), "../../../../runtime")
const HELPER_SRC = path.join(SRC_ROOT, "mac_helper.py")
const REQUIREMENTS_SRC = path.join(SRC_ROOT, "requirements.txt")

// Deployed copies inside the runtime dir
const HELPER_DST = path.join(RUNTIME_DIR, "mac_helper.py")
const REQUIREMENTS_DST = path.join(RUNTIME_DIR, "requirements.txt")

// ── State ────────────────────────────────────────────────────────────

let bootstrapped = false
let bootstrapping: Promise<void> | null = null

// ── Internal helpers ─────────────────────────────────────────────────

async function fileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath)
  return crypto.createHash("sha256").update(content).digest("hex")
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

async function copyIfNewer(src: string, dst: string): Promise<boolean> {
  const srcContent = await fs.readFile(src)
  let changed = false
  try {
    const dstContent = await fs.readFile(dst)
    if (!srcContent.equals(dstContent)) changed = true
  } catch {
    changed = true
  }
  if (changed) {
    await fs.writeFile(dst, srcContent)
  }
  return changed
}

/** Create venv if missing, install deps if requirements changed. */
async function bootstrapImpl(): Promise<void> {
  await ensureDir(RUNTIME_DIR)

  // Copy helper and requirements into the runtime dir
  await copyIfNewer(HELPER_SRC, HELPER_DST)
  const reqChanged = await copyIfNewer(REQUIREMENTS_SRC, REQUIREMENTS_DST)

  // Create venv if missing
  try {
    await fs.access(PYTHON_BIN)
  } catch {
    await new Promise<void>((resolve, reject) => {
      execFile("python3", ["-m", "venv", VENV_DIR], (err, _stdout, stderr) => {
        if (err) reject(new Error(`Failed to create venv: ${err.message}\n${stderr}`))
        else resolve()
      })
    })
  }

  // Install deps if requirements changed or hash mismatch
  const currentHash = await fileHash(REQUIREMENTS_DST)
  let savedHash = ""
  try {
    savedHash = (await fs.readFile(REQUIREMENTS_HASH_FILE, "utf8")).trim()
  } catch {
    // first install
  }

  if (reqChanged || currentHash !== savedHash) {
    await new Promise<void>((resolve, reject) => {
      execFile(PIP_BIN, ["install", "-q", "-r", REQUIREMENTS_DST], { timeout: 120_000 }, (err, _stdout, stderr) => {
        if (err) reject(new Error(`pip install failed: ${err.message}\n${stderr}`))
        else resolve()
      })
    })
    await fs.writeFile(REQUIREMENTS_HASH_FILE, currentHash)
  }

  bootstrapped = true
}

// ── Public API ───────────────────────────────────────────────────────

/** Ensure the Python runtime is ready (idempotent, concurrent-safe). */
export async function ensureBootstrapped(): Promise<void> {
  if (bootstrapped) return
  if (!bootstrapping) {
    bootstrapping = bootstrapImpl()
  }
  await bootstrapping
}

/** Call a mac_helper.py command and return the parsed result. */
export async function callPythonHelper<T = unknown>(
  command: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  await ensureBootstrapped()

  const payloadJson = JSON.stringify(payload)

  return new Promise<T>((resolve, reject) => {
    execFile(
      PYTHON_BIN,
      [HELPER_DST, command, "--payload", payloadJson],
      { timeout: 30_000, maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Python helper error: ${err.message}\n${stderr}`))
          return
        }
        try {
          const parsed = JSON.parse(stdout.trim())
          if (!parsed.ok) {
            reject(new Error(parsed.error?.message || "Unknown Python error"))
            return
          }
          resolve(parsed.result as T)
        } catch (parseErr) {
          reject(new Error(`Failed to parse Python output: ${stdout.slice(0, 200)}`))
        }
      },
    )
  })
}

/** Check if the current platform is supported. */
export function isSupportedPlatform(): boolean {
  return process.platform === "darwin"
}

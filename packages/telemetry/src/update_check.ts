import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import semver from "semver"
import type { CachedUpdateCheck, ClientType, InstallMethod, UpdateInfo } from "./types.ts"

/**
 * 24-hour local cache for update-check responses.
 *
 * Cache file: ~/.cache/opencode/update_check.json
 *
 * Why 24h: cli/desktop both check on every launch — without a cache we'd
 * hammer the static endpoint pointlessly and slow down `opencode --version`.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export function defaultCacheDir(): string {
  const home = process.env.OPENCODE_TEST_HOME || os.homedir()
  return path.join(home, ".cache", "opencode")
}

function defaultCacheFile(dir?: string): string {
  return path.join(dir ?? defaultCacheDir(), "update_check.json")
}

/** Default URL builder for the GET /v1/latest/<client>/latest.json endpoint. */
export function defaultUpdateUrl(clientType: ClientType): string {
  return `https://updates.deskfox.ai/v1/latest/${clientType}/latest.json`
}

interface RawLatest {
  version: string
  released_at?: string
  min_supported_version?: string
  upgrade_commands?: Record<string, string>
  release_notes_url?: string
  is_security_update?: boolean
}

export interface CheckUpdateOptions {
  clientType: ClientType
  appVersion: string
  /** Override the URL (mostly tests). */
  url?: string
  /** Inject fetch (mostly tests). */
  fetchImpl?: typeof fetch
  /** Override cache dir (mostly tests). */
  cacheDir?: string
  /** Skip cache reads. Useful for tests / forced refresh. */
  skipCache?: boolean
  /** Override the install method detection (mostly tests / advanced callers). */
  installMethod?: InstallMethod
  /** Per-request timeout. Default 5s. */
  requestTimeoutMs?: number
}

/**
 * Run the full update-check flow: cache → network → cache write → return.
 *
 * Returns `null` on full failure (no cache, network failed). Callers that
 * want a non-null promise can ignore the null case (no banner shown).
 */
export async function checkUpdate(opts: CheckUpdateOptions): Promise<UpdateInfo | null> {
  const cacheFile = defaultCacheFile(opts.cacheDir)

  // 1. Try cache.
  if (!opts.skipCache) {
    const cached = await readCache(cacheFile)
    if (cached) {
      // Re-evaluate hasUpdate against the *current* appVersion in case the
      // user upgraded since the cache was written.
      return decorate(cached.data, opts.appVersion, opts.installMethod)
    }
  }

  // 2. Fetch fresh.
  const url = opts.url ?? defaultUpdateUrl(opts.clientType)
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const timeout = opts.requestTimeoutMs ?? 5_000

  let raw: RawLatest | null = null
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetchImpl(url, { method: "GET", signal: controller.signal })
    if (res.ok) {
      raw = (await res.json()) as RawLatest
    }
  } catch {
    raw = null
  } finally {
    clearTimeout(t)
  }

  if (!raw || typeof raw.version !== "string") return null

  const info: UpdateInfo = {
    hasUpdate: false, // filled in by decorate()
    latest: raw.version,
    releasedAt: raw.released_at,
    minSupportedVersion: raw.min_supported_version,
    upgradeCommands: raw.upgrade_commands,
    releaseNotesUrl: raw.release_notes_url,
    isSecurityUpdate: raw.is_security_update ?? false,
  }

  // 3. Persist cache (best-effort; never throw).
  await writeCache(cacheFile, info)

  return decorate(info, opts.appVersion, opts.installMethod)
}

function decorate(info: UpdateInfo, appVersion: string, installMethod: InstallMethod | undefined): UpdateInfo {
  let hasUpdate = false
  try {
    hasUpdate = semver.gt(info.latest, appVersion)
  } catch {
    // bad semver — silently treat as "no update".
  }

  let upgradeCommand: string | undefined
  if (info.upgradeCommands && installMethod && installMethod !== "unknown") {
    upgradeCommand = info.upgradeCommands[installMethod]
  }
  return { ...info, hasUpdate, upgradeCommand }
}

async function readCache(file: string): Promise<CachedUpdateCheck | null> {
  try {
    const raw = await fs.readFile(file, "utf8")
    const parsed = JSON.parse(raw) as CachedUpdateCheck
    if (
      typeof parsed.fetchedAt !== "number" ||
      !parsed.data ||
      typeof parsed.data.latest !== "string"
    ) {
      return null
    }
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

async function writeCache(file: string, data: UpdateInfo): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const payload: CachedUpdateCheck = { fetchedAt: Date.now(), data }
    await fs.writeFile(file, JSON.stringify(payload), "utf8")
  } catch {
    // ignore
  }
}

/**
 * Detect how the CLI was installed, so we can show the right `upgrade`
 * command. We do *cheap* checks first (env / argv0 path) and only fall back
 * to spawning subprocesses (`npm root -g`, `command -v brew`) when needed.
 *
 * Heuristic order:
 *   1. `process.env.OPENCODE_INSTALL_METHOD` (escape hatch)
 *   2. argv0 path under a known npm-global / brew prefix
 *   3. Run `command -v brew` etc. (only on POSIX; on Windows we skip subshell)
 *   4. Default to "unknown"
 */
export async function detectInstallMethod(): Promise<InstallMethod> {
  const override = process.env.OPENCODE_INSTALL_METHOD
  if (override === "npm" || override === "bun" || override === "brew" || override === "curl") {
    return override
  }

  const argv0 = process.argv[1] ?? ""
  const lc = argv0.toLowerCase()

  if (lc.includes("/.bun/")) return "bun"
  if (lc.includes("/homebrew/") || lc.includes("/cellar/") || lc.includes("/brew/")) return "brew"
  if (lc.includes("/node_modules/") || lc.includes("/npm/")) return "npm"

  // POSIX shell-based fallback. We deliberately keep this best-effort and
  // short-timeout: if `which`/`command` aren't around, just return unknown.
  if (process.platform !== "win32") {
    const brew = await trySpawn("command", ["-v", "brew"])
    if (brew) return "brew"
    // npm global root check — looks for our package under `<npm root -g>/opencode`.
    const npmRoot = await trySpawn("npm", ["root", "-g"])
    if (npmRoot && argv0.startsWith(npmRoot.trim())) return "npm"
  }

  return "unknown"
}

async function trySpawn(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { spawn } = await import("node:child_process")
    return await new Promise<string | null>((resolve) => {
      const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] })
      let buf = ""
      const t = setTimeout(() => {
        child.kill()
        resolve(null)
      }, 1_000)
      child.stdout?.on("data", (d: Buffer) => {
        buf += d.toString()
      })
      child.on("error", () => {
        clearTimeout(t)
        resolve(null)
      })
      child.on("exit", (code) => {
        clearTimeout(t)
        resolve(code === 0 ? buf : null)
      })
    })
  } catch {
    return null
  }
}

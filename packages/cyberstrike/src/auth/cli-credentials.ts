import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { Log } from "../util/log"

const log = Log.create({ service: "cli-credentials" })

const CLAUDE_CLI_CREDENTIALS_PATH = ".claude/.credentials.json"
const CLAUDE_CLI_KEYCHAIN_SERVICE = "Claude Code-credentials"

export type ClaudeCliCredential =
  | {
      type: "oauth"
      access: string
      refresh: string
      expires: number
    }
  | {
      type: "token"
      token: string
      expires: number
    }

// Cache the `which claude` result to avoid repeated exec calls
let claudeCliInstalledCache: boolean | null = null

/**
 * Read Claude Code CLI credentials from macOS Keychain
 */
function readFromKeychain(): ClaudeCliCredential | null {
  if (process.platform !== "darwin") return null

  try {
    const proc = Bun.spawnSync(["security", "find-generic-password", "-s", CLAUDE_CLI_KEYCHAIN_SERVICE, "-w"], {
      stdout: "pipe",
      stderr: "pipe",
    })

    if (proc.exitCode !== 0) return null

    const result = proc.stdout.toString().trim()
    const data = JSON.parse(result)
    const claudeOauth = data?.claudeAiOauth
    if (!claudeOauth || typeof claudeOauth !== "object") return null

    const accessToken = claudeOauth.accessToken
    const refreshToken = claudeOauth.refreshToken
    const expiresAt = claudeOauth.expiresAt

    if (typeof accessToken !== "string" || !accessToken) return null
    if (typeof expiresAt !== "number" || expiresAt <= 0) return null

    if (typeof refreshToken === "string" && refreshToken) {
      log.info("read credentials from claude cli keychain", { type: "oauth" })
      return {
        type: "oauth",
        access: accessToken,
        refresh: refreshToken,
        expires: expiresAt,
      }
    }

    log.info("read credentials from claude cli keychain", { type: "token" })
    return {
      type: "token",
      token: accessToken,
      expires: expiresAt,
    }
  } catch {
    return null
  }
}

/**
 * Read Claude Code CLI credentials from file (~/.claude/.credentials.json)
 */
function readFromFile(): ClaudeCliCredential | null {
  const credPath = path.join(os.homedir(), CLAUDE_CLI_CREDENTIALS_PATH)

  try {
    if (!fs.existsSync(credPath)) return null

    const raw = JSON.parse(fs.readFileSync(credPath, "utf8"))
    if (!raw || typeof raw !== "object") return null

    const claudeOauth = raw.claudeAiOauth
    if (!claudeOauth || typeof claudeOauth !== "object") return null

    const accessToken = claudeOauth.accessToken
    const refreshToken = claudeOauth.refreshToken
    const expiresAt = claudeOauth.expiresAt

    if (typeof accessToken !== "string" || !accessToken) return null
    if (typeof expiresAt !== "number" || expiresAt <= 0) return null

    if (typeof refreshToken === "string" && refreshToken) {
      log.info("read credentials from claude cli file", { type: "oauth" })
      return {
        type: "oauth",
        access: accessToken,
        refresh: refreshToken,
        expires: expiresAt,
      }
    }

    log.info("read credentials from claude cli file", { type: "token" })
    return {
      type: "token",
      token: accessToken,
      expires: expiresAt,
    }
  } catch {
    return null
  }
}

/**
 * Check if Claude Code CLI is installed (cached)
 */
export function isClaudeCliInstalled(): boolean {
  if (claudeCliInstalledCache !== null) return claudeCliInstalledCache

  try {
    const proc = Bun.spawnSync(["which", "claude"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    claudeCliInstalledCache = proc.exitCode === 0
  } catch {
    claudeCliInstalledCache = false
  }

  return claudeCliInstalledCache
}

/**
 * Read Claude Code CLI credentials
 * Tries Keychain first (macOS), then falls back to file
 */
export function readClaudeCliCredentials(): ClaudeCliCredential | null {
  const keychainCreds = readFromKeychain()
  if (keychainCreds) return keychainCreds
  return readFromFile()
}

/**
 * Check if Claude Code CLI credentials are valid (not expired)
 */
export function hasValidClaudeCliCredentials(): boolean {
  const creds = readClaudeCliCredentials()
  if (!creds) return false

  const now = Date.now()
  const buffer = 5 * 60 * 1000
  return creds.expires > now + buffer
}

/**
 * Get the access token from Claude Code CLI credentials
 */
export function getClaudeCliAccessToken(): string | null {
  const creds = readClaudeCliCredentials()
  if (!creds) return null

  if (creds.type === "oauth") return creds.access
  return creds.token
}

/**
 * Refresh the Claude CLI OAuth token using the refresh token
 */
export async function refreshClaudeCliToken(): Promise<string | null> {
  const creds = readClaudeCliCredentials()
  if (!creds || creds.type !== "oauth") {
    log.warn("no oauth credentials to refresh")
    return null
  }

  try {
    const proc = Bun.spawn(["claude", "auth", "refresh", "--json"], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const exitCode = await proc.exited
    if (exitCode !== 0) {
      log.error("claude auth refresh failed", { exitCode })
      return null
    }

    const result = await new Response(proc.stdout).text()
    const parsed = JSON.parse(result.trim())
    if (parsed.accessToken) {
      log.info("refreshed claude cli token")
      return parsed.accessToken
    }

    const newCreds = readClaudeCliCredentials()
    if (newCreds) {
      return newCreds.type === "oauth" ? newCreds.access : newCreds.token
    }

    return null
  } catch (error) {
    log.error("failed to refresh claude cli token", {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getValidClaudeCliToken(): Promise<string | null> {
  const creds = readClaudeCliCredentials()
  if (!creds) return null

  const token = creds.type === "oauth" ? creds.access : creds.token
  const now = Date.now()
  const buffer = 5 * 60 * 1000

  if (creds.expires > now + buffer) return token

  if (creds.type === "oauth") {
    log.info("token expired, attempting refresh")
    return await refreshClaudeCliToken()
  }

  log.warn("token expired and cannot refresh (not oauth)")
  return null
}

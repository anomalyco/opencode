import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export type Credentials = {
  token: string
  userdata: string
  savedAt: string
  expiresAt?: string
  source?: string
}

export function credentialsPath(): string {
  return process.env.WB_CREDS_FILE ?? join(homedir(), ".config", "wb-harness", "credentials.json")
}

export function readCredentials(): Credentials | undefined {
  const path = credentialsPath()
  if (!existsSync(path)) return
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Credentials>
    if (!value.token || !value.userdata) return
    return {
      token: value.token,
      userdata: value.userdata,
      savedAt: value.savedAt ?? new Date(0).toISOString(),
      expiresAt: value.expiresAt,
      source: value.source,
    }
  } catch {
    return
  }
}

export function writeCredentials(credentials: Credentials): string {
  const path = credentialsPath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  return path
}

/** Reads `exp` from a JWT without verifying the signature. */
export function tokenExpiry(token: string): string | undefined {
  const payload = decodeJWT(token)
  if (typeof payload?.exp !== "number") return
  return new Date(payload.exp * 1000).toISOString()
}

export function decodeJWT(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".")
  if (parts.length !== 3 || !parts[1]) return
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>
  } catch {
    return
  }
}

export function describeCredentials(credentials: Credentials): string {
  const payload = decodeJWT(credentials.token)
  const expires = credentials.expiresAt ?? tokenExpiry(credentials.token) ?? "unknown"
  return [
    `token ${credentials.token.length} chars, expires ${expires}`,
    `client_id ${String(payload?.client_id ?? "?")}, sub ${String(payload?.sub ?? "?")}`,
    `userdata ${credentials.userdata.length} chars`,
    `saved at ${credentials.savedAt}`,
  ].join("\n")
}

import path from "path"
import fs from "fs/promises"
import crypto from "crypto"
import { Global } from "@/global"
import { VaultFS } from "./fs"

export namespace VaultKey {
  const KEY_ENV = "OPENCODE_VAULT_KEY"
    // Store key in data dir alongside credentials for backup/restore locality.
  // Users backing up ~/.local/share/opencode will get both key + encrypted creds.
  const KEY_PATH = path.join(Global.Path.data, "vault.key")
  const KEY_BYTES = 32
  let cached: Buffer | undefined

  export function envVarName(): string {
    return KEY_ENV
  }

  export function keyPath(): string {
    return KEY_PATH
  }

  function decodeBase64Key(input: string): Buffer {
    const buf = Buffer.from(input.trim(), "base64")
    if (buf.length !== KEY_BYTES) {
      throw new Error(`Invalid vault key length. Expected ${KEY_BYTES} bytes, got ${buf.length}.`)
    }
    return buf
  }

  async function loadFromFile(): Promise<Buffer | undefined> {
    if (!(await VaultFS.exists(KEY_PATH))) return undefined
    const raw = await fs.readFile(KEY_PATH, "utf8")
    return decodeBase64Key(raw)
  }

  async function writeKeyToFile(key: Buffer): Promise<void> {
    await VaultFS.atomicWriteText(KEY_PATH, key.toString("base64"), 0o600)
    // Bun can ignore mode on write; harden after.
    await fs.chmod(KEY_PATH, 0o600).catch(() => {})
  }

  export async function load(): Promise<Buffer> {
    const env = process.env[KEY_ENV]
    if (env) return decodeBase64Key(env)

    if (cached) return cached
    const fromFile = await loadFromFile()
    if (fromFile) {
      cached = fromFile
      return cached
    }

    cached = crypto.randomBytes(KEY_BYTES)
    await writeKeyToFile(cached)
    return cached
  }

  export async function init(opts?: { force?: boolean }): Promise<{ path: string; created: boolean; source: "env" | "generated" | "existing" }> {
    const env = process.env[KEY_ENV]
    const envKey = env ? decodeBase64Key(env) : undefined

    const existing = await loadFromFile()
    if (existing && !opts?.force) {
      cached = existing
      return { path: KEY_PATH, created: false, source: "existing" }
    }

    const next = envKey ?? crypto.randomBytes(KEY_BYTES)
    await writeKeyToFile(next)
    cached = next
    return { path: KEY_PATH, created: true, source: envKey ? "env" : "generated" }
  }

  export async function exportBase64(): Promise<string> {
    const key = await load()
    return key.toString("base64")
  }

  export async function importBase64(input: string): Promise<{ path: string }> {
    const key = decodeBase64Key(input)
    await writeKeyToFile(key)
    cached = key
    return { path: KEY_PATH }
  }
}

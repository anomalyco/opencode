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

  function decodeBase64Key(input: string): Buffer {
    const buf = Buffer.from(input.trim(), "base64")
    if (buf.length !== KEY_BYTES) {
      throw new Error(`Invalid vault key length. Expected ${KEY_BYTES} bytes, got ${buf.length}.`)
    }
    return buf
  }

  async function generateAndPersist(): Promise<Buffer> {
    const key = crypto.randomBytes(KEY_BYTES)
    await VaultFS.atomicWriteText(KEY_PATH, key.toString("base64"), 0o600)
    // Bun can ignore mode on write; harden after.
    await fs.chmod(KEY_PATH, 0o600).catch(() => {})
    return key
  }

  export async function load(): Promise<Buffer> {
    const env = process.env[KEY_ENV]
    if (env) return decodeBase64Key(env)

    if (cached) return cached
    if (await VaultFS.exists(KEY_PATH)) {
      const raw = await fs.readFile(KEY_PATH, "utf8")
      cached = decodeBase64Key(raw)
      return cached
    }

    cached = await generateAndPersist()
    return cached
  }
}

import type { Config } from "../config/config"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { Log } from "../util/log"
import z from "zod"

export namespace VpsAuth {
  const log = Log.create({ service: "vps.auth" })

  export interface Credentials {
    privateKey?: Buffer
    passphrase?: string
    password?: string
    agent?: string
  }

  /**
   * Get SSH credentials from VPS configuration
   */
  export async function getCredentials(config: Config.VpsConnection): Promise<Credentials> {
    const auth = config.auth

    switch (auth.type) {
      case "key": {
        const keyPath = expandPath(auth.keyPath)
        log.info("loading SSH key", { keyPath })

        try {
          const privateKey = await fs.readFile(keyPath)
          return {
            privateKey,
            passphrase: auth.passphrase,
          }
        } catch (error: any) {
          if (error.code === "ENOENT") {
            throw new Error(`SSH key not found: ${keyPath}`)
          }
          throw new Error(`Failed to read SSH key: ${error.message}`)
        }
      }

      case "password": {
        if (auth.promptPassword && !auth.password) {
          // Password will be prompted via the question tool
          return { password: undefined }
        }
        return { password: auth.password }
      }

      case "agent": {
        const agent = process.env.SSH_AUTH_SOCK
        if (!agent) {
          throw new Error("SSH_AUTH_SOCK environment variable not set. Is ssh-agent running?")
        }
        log.info("using SSH agent", { agent })
        return { agent }
      }
    }
  }

  /**
   * Expand ~ to home directory in paths
   */
  function expandPath(filepath: string): string {
    if (filepath.startsWith("~/")) {
      return path.join(os.homedir(), filepath.slice(2))
    }
    if (filepath.startsWith("~")) {
      return path.join(os.homedir(), filepath.slice(1))
    }
    return filepath
  }

  /**
   * Find default SSH key paths
   */
  export async function findDefaultKeyPath(): Promise<string | null> {
    const defaultKeys = [
      "~/.ssh/id_ed25519",
      "~/.ssh/id_rsa",
      "~/.ssh/id_ecdsa",
      "~/.ssh/id_dsa",
    ]

    for (const keyPath of defaultKeys) {
      const expanded = expandPath(keyPath)
      try {
        await fs.access(expanded)
        return expanded
      } catch {
        // Key doesn't exist, try next
      }
    }

    return null
  }

  /**
   * Validate SSH key format
   */
  export async function validateKey(keyPath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(expandPath(keyPath), "utf-8")
      return (
        content.includes("-----BEGIN") &&
        (content.includes("PRIVATE KEY-----") || content.includes("OPENSSH PRIVATE KEY-----"))
      )
    } catch {
      return false
    }
  }

  /**
   * Password storage interface for secure credential storage
   */
  export interface PasswordStore {
    set(host: string, user: string, password: string): Promise<void>
    get(host: string, user: string): Promise<string | null>
    delete(host: string, user: string): Promise<void>
  }

  /**
   * In-memory password store (for session-only storage)
   */
  class MemoryPasswordStore implements PasswordStore {
    private passwords = new Map<string, string>()

    private key(host: string, user: string): string {
      return `${user}@${host}`
    }

    async set(host: string, user: string, password: string): Promise<void> {
      this.passwords.set(this.key(host, user), password)
    }

    async get(host: string, user: string): Promise<string | null> {
      return this.passwords.get(this.key(host, user)) || null
    }

    async delete(host: string, user: string): Promise<void> {
      this.passwords.delete(this.key(host, user))
    }
  }

  // Default to in-memory store
  let passwordStore: PasswordStore = new MemoryPasswordStore()

  export function setPasswordStore(store: PasswordStore): void {
    passwordStore = store
  }

  export function getPasswordStore(): PasswordStore {
    return passwordStore
  }
}

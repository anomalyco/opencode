import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const CONFIG_DIR = join(homedir(), ".config", "opencode")
const CONFIG_FILE = join(CONFIG_DIR, "ssh-defaults.json")

export interface SshDefaults {
  host?: string
  username?: string
  keyPath?: string
  port?: number
}

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

function read(): SshDefaults {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"))
    }
  } catch { /* ignore */ }
  return {}
}

function write(data: SshDefaults) {
  ensureDir()
  writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2))
}

export const tool = {
  name: "ssh-config",
  description: "Save or show default SSH connection parameters. All fields are optional; only provided fields are saved. Call with no args to show current config.",
  schema: {
    input: {
      host: "string",
      username: "string",
      keyPath: "string",
      port: "number",
    },
    output: {
      host: "string",
      username: "string",
      keyPath: "string",
      port: "number",
      message: "string",
    },
  },
}

export default function sshConfig(input: {
  host?: string
  username?: string
  keyPath?: string
  port?: number
}) {
  const current = read()

  const hasChanges = input.host !== undefined || input.username !== undefined || input.keyPath !== undefined || input.port !== undefined

  if (hasChanges) {
    const updated: SshDefaults = {
      host: input.host ?? current.host,
      username: input.username ?? current.username,
      keyPath: input.keyPath ?? current.keyPath,
      port: input.port ?? current.port,
    }
    write(updated)
    return { ...updated, message: "SSH defaults saved" }
  }

  return { ...current, message: current.host ? "Current SSH defaults" : "No SSH defaults configured" }
}

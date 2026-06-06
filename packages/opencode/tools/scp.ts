import { spawnSync } from "child_process"
import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const CONFIG_FILE = join(homedir(), ".config", "opencode", "ssh-defaults.json")

interface SshDefaults {
  host?: string
  username?: string
  keyPath?: string
  port?: number
}

function readDefaults(): SshDefaults {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"))
    }
  } catch { /* ignore */ }
  return {}
}

export const tool = {
  name: "scp",
  description: "Copy files or directories to a remote server via SCP with key-based auth. Falls back to saved ssh-config defaults for omitted fields.",
  schema: {
    input: {
      host: "string",
      username: "string",
      keyPath: "string",
      localPath: "string",
      remotePath: "string",
      recursive: "boolean",
    },
    output: {
      success: "boolean",
      message: "string",
    },
  },
}

export default function scp(input: {
  host?: string
  username?: string
  keyPath?: string
  port?: number
  localPath: string
  remotePath: string
  recursive?: boolean
}) {
  const defaults = readDefaults()
  const host = input.host ?? defaults.host
  const username = input.username ?? defaults.username
  const keyPath = input.keyPath ?? defaults.keyPath
  const port = input.port ?? defaults.port ?? 22
  const { localPath, remotePath, recursive = false } = input

  if (!host) return { success: false, message: "host is required (set via ssh-config or pass directly)" }
  if (!username) return { success: false, message: "username is required (set via ssh-config or pass directly)" }
  if (!localPath) return { success: false, message: "localPath is required" }
  if (!remotePath) return { success: false, message: "remotePath is required" }

  const args = [
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=15",
    "-P", String(port),
  ]

  if (keyPath) args.push("-i", keyPath)
  if (recursive) args.push("-r")

  args.push(localPath, `${username}@${host}:${remotePath}`)

  const cmd = ["scp", ...args.map((a) => (a.includes(" ") ? `"${a}"` : a))].join(" ")

  try {
    const result = spawnSync(cmd, [], {
      encoding: "utf-8",
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      shell: true,
      windowsHide: true,
    })

    if (result.status === 0) {
      return { success: true, message: `Copied to ${host}:${remotePath}` }
    }
    return {
      success: false,
      message: (result.stderr || result.stdout || "").trim() || "SCP failed",
    }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) }
  }
}

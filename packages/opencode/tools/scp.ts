import { spawnSync } from "child_process"

export const tool = {
  name: "scp",
  description: "Copy files or directories to a remote server via SCP with key-based auth.",
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
  host: string
  username: string
  keyPath?: string
  port?: number
  localPath: string
  remotePath: string
  recursive?: boolean
}) {
  const { host, username, keyPath, port = 22, localPath, remotePath, recursive = false } = input

  if (!host) return { success: false, message: "host is required" }
  if (!username) return { success: false, message: "username is required" }
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

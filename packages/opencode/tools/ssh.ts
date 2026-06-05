import { spawnSync } from "child_process"
import { existsSync } from "fs"

export const tool = {
  name: "ssh",
  description: "Execute shell commands on a remote server via SSH with key-based auth.",
  schema: {
    input: {
      host: "string",
      username: "string",
      keyPath: "string",
      command: "string",
      port: "number",
    },
    output: {
      success: "boolean",
      stdout: "string",
      stderr: "string",
      exitCode: "number",
    },
  },
}

export default function ssh(input: {
  host: string
  username: string
  keyPath?: string
  port?: number
  command: string
}) {
  const { host, username, keyPath, port = 22, command } = input

  if (!host) return { success: false, stdout: "", stderr: "host is required", exitCode: 1 }
  if (!username) return { success: false, stdout: "", stderr: "username is required", exitCode: 1 }
  if (!command) return { success: false, stdout: "", stderr: "command is required", exitCode: 1 }

  const args = [
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=15",
    "-o", "BatchMode=yes",
    "-p", String(port),
  ]

  if (keyPath) {
    if (!existsSync(keyPath)) {
      return { success: false, stdout: "", stderr: `SSH key not found: ${keyPath}`, exitCode: 1 }
    }
    args.push("-i", keyPath)
  }

  args.push(`${username}@${host}`, command)

  const cmd = ["ssh", ...args.map((a) => (a.includes(" ") ? `"${a}"` : a))].join(" ")

  try {
    const result = spawnSync(cmd, [], {
      encoding: "utf-8",
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
      shell: true,
      windowsHide: true,
    })
    return {
      success: result.status === 0,
      stdout: (result.stdout || "").trim(),
      stderr: (result.stderr || "").trim(),
      exitCode: result.status ?? 1,
    }
  } catch (error) {
    return {
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    }
  }
}

import { spawnSync } from "child_process"
import { existsSync } from "fs"

export const tool = {
  name: "remote",
  description:
    "Execute shell commands on remote servers via SSH. Also performs git-based deployments (pull, build, restart). Supports key-based and password (sshpass) authentication.",
  schema: {
    input: {
      host: "string",
      username: "string",
      port: "number",
      keyPath: "string",
      password: "string",
      command: "string",
      deploy: "boolean",
      repo: "string",
      branch: "string",
      targetDir: "string",
      buildCommand: "string",
      restartCommand: "string",
    },
    output: {
      success: "boolean",
      stdout: "string",
      stderr: "string",
      exitCode: "number",
    },
  },
}

function ssh(input: {
  host: string
  username: string
  port: number
  keyPath?: string
  password?: string
  command: string
}) {
  const args = [
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=15",
    "-o",
    "BatchMode=yes",
    "-p",
    String(input.port),
  ]

  if (input.keyPath) {
    if (!existsSync(input.keyPath)) {
      return { success: false, stdout: "", stderr: `SSH key not found: ${input.keyPath}`, exitCode: 1 }
    }
    args.push("-i", input.keyPath)
  }

  args.push(`${input.username}@${input.host}`, input.command)

  let cmd = ["ssh", ...args.map((a) => (a.includes(" ") ? `"${a}"` : a))].join(" ")
  if (input.password) {
    cmd = `sshpass -p '${input.password.replace(/'/g, "'\\''")}' ${cmd}`
  }

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

export default function remote(input: {
  host: string
  username: string
  port?: number
  keyPath?: string
  password?: string
  command?: string
  deploy?: boolean
  repo?: string
  branch?: string
  targetDir?: string
  buildCommand?: string
  restartCommand?: string
}) {
  const { host, username, port = 22, keyPath, password } = input

  if (!host) return { success: false, stdout: "", stderr: "host is required", exitCode: 1 }
  if (!username) return { success: false, stdout: "", stderr: "username is required", exitCode: 1 }

  if (input.deploy) {
    if (!input.targetDir) return { success: false, stdout: "", stderr: "targetDir is required for deploy", exitCode: 1 }
    if (!input.repo) return { success: false, stdout: "", stderr: "repo is required for deploy", exitCode: 1 }

    const branch = input.branch || "main"
    const targetDir = input.targetDir
    const buildCmd = input.buildCommand || "npm run build"
    const restartCmd = input.restartCommand || "pm2 restart all || systemctl restart app || exit 0"

    const steps = [
      `mkdir -p ${targetDir}`,
      `if [ -d "${targetDir}/.git" ]; then cd ${targetDir} && git fetch origin && git reset --hard origin/${branch}; else git clone --depth 1 -b ${branch} ${input.repo} ${targetDir}; fi`,
      `cd ${targetDir}`,
      buildCmd,
      restartCmd,
    ]

    const allOutput: string[] = []
    let allOk = true

    for (const step of steps) {
      const result = ssh({ host, username, port, keyPath, password, command: step })
      allOutput.push(`$ ${step}`)
      allOutput.push(result.stdout)
      if (!result.success) {
        allOutput.push(`ERROR: ${result.stderr}`)
        allOk = false
        break
      }
    }

    return {
      success: allOk,
      stdout: allOutput.join("\n"),
      stderr: allOk ? "" : "Deploy failed",
      exitCode: allOk ? 0 : 1,
    }
  }

  if (!input.command) return { success: false, stdout: "", stderr: "command or deploy=true is required", exitCode: 1 }
  return ssh({ host, username, port, keyPath, password, command: input.command })
}

import z from "zod"
import { Tool } from "./tool"
import { VpsContext } from "../vps/context"
import { VpsConnection } from "../vps/connection"
import { VpsSftp } from "../vps/sftp"
import { Config } from "../config/config"
import { Log } from "../util/log"

const log = Log.create({ service: "vps-exec-tool" })

const MAX_OUTPUT_LENGTH = 100_000

const DESCRIPTION = `Execute commands on a remote VPS server via SSH.

This tool allows you to:
- Execute shell commands on connected VPS servers
- Read and write files on remote servers
- Navigate directories and manage files remotely

Usage:
- If you're in a VPS context (switched via 'cd vps <name>'), commands run on that VPS automatically
- You can also specify a VPS by name to run commands on a specific server

Commands:
- exec: Execute a shell command on the VPS
- read: Read a file from the VPS
- write: Write content to a file on the VPS
- ls: List directory contents on the VPS
- switch: Switch context to a VPS or back to local

Examples:
- Execute command: { "action": "exec", "command": "ls -la /var/www" }
- Read file: { "action": "read", "path": "/etc/nginx/nginx.conf" }
- Write file: { "action": "write", "path": "/tmp/test.txt", "content": "Hello World" }
- List directory: { "action": "ls", "path": "/home/ubuntu" }
- Switch to VPS: { "action": "switch", "target": "production" }
- Switch to local: { "action": "switch", "target": "local" }
`

// Common result type for all VPS tool actions
interface VpsToolResult {
  title: string
  metadata: Record<string, any>
  output: string
}

export const VpsExecTool = Tool.define<any, Record<string, any>>("vps", {
  description: DESCRIPTION,
  parameters: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("exec"),
      command: z.string().describe("Shell command to execute"),
      vps: z.string().optional().describe("VPS config key (uses current context if not specified)"),
      cwd: z.string().optional().describe("Working directory for command"),
      timeout: z.number().optional().describe("Command timeout in milliseconds"),
    }),
    z.object({
      action: z.literal("read"),
      path: z.string().describe("Remote file path to read"),
      vps: z.string().optional().describe("VPS config key (uses current context if not specified)"),
    }),
    z.object({
      action: z.literal("write"),
      path: z.string().describe("Remote file path to write"),
      content: z.string().describe("Content to write"),
      vps: z.string().optional().describe("VPS config key (uses current context if not specified)"),
    }),
    z.object({
      action: z.literal("ls"),
      path: z.string().optional().describe("Remote directory path (defaults to current directory)"),
      vps: z.string().optional().describe("VPS config key (uses current context if not specified)"),
    }),
    z.object({
      action: z.literal("switch"),
      target: z.string().describe("Target context: 'local' or VPS config key"),
    }),
    z.object({
      action: z.literal("status"),
    }),
    z.object({
      action: z.literal("connect"),
      vps: z.string().describe("VPS config key to connect to"),
      password: z.string().optional().describe("SSH password (if using password auth)"),
    }),
    z.object({
      action: z.literal("disconnect"),
      vps: z.string().optional().describe("VPS config key or ID to disconnect"),
    }),
  ]),
  async execute(params, ctx): Promise<VpsToolResult> {
    switch (params.action) {
      case "exec":
        return await execCommand(params, ctx)
      case "read":
        return await readFile(params, ctx)
      case "write":
        return await writeFile(params, ctx)
      case "ls":
        return await listDirectory(params, ctx)
      case "switch":
        return await switchContext(params, ctx)
      case "status":
        return await getStatus(ctx)
      case "connect":
        return await connectVps(params, ctx)
      case "disconnect":
        return await disconnectVps(params, ctx)
      default:
        throw new Error(`Unknown VPS action: ${(params as any).action}`)
    }
  },
})

async function getVpsId(vpsKey?: string): Promise<string> {
  // If vps specified, find or connect to it
  if (vpsKey) {
    const existing = VpsConnection.getByKey(vpsKey)
    if (existing && existing.status === "connected") {
      return existing.id
    }

    // Try to connect
    const config = await Config.get()
    const vpsConfig = config.vps?.[vpsKey]
    if (!vpsConfig) {
      throw new Error(`VPS '${vpsKey}' not found in configuration`)
    }

    const info = await VpsConnection.connect(vpsKey, vpsConfig)
    return info.id
  }

  // Use current context
  const context = VpsContext.getCurrent()
  if (context.type !== "vps" || !context.vpsId) {
    throw new Error("Not in VPS context. Use 'switch' action or specify 'vps' parameter.")
  }

  return context.vpsId
}

async function execCommand(
  params: { command: string; vps?: string; cwd?: string; timeout?: number },
  ctx: any
) {
  const vpsId = await getVpsId(params.vps)
  const vpsInfo = VpsConnection.get(vpsId)!

  await ctx.ask({
    permission: "bash",
    patterns: [`[VPS:${vpsInfo.nickname}] ${params.command}`],
    always: [`[VPS:${vpsInfo.nickname}] *`],
    metadata: {
      vps: vpsInfo.nickname,
      command: params.command,
    },
  })

  log.info("Executing VPS command", { vpsId, command: params.command, cwd: params.cwd })

  const result = await VpsConnection.exec(vpsId, params.command, {
    cwd: params.cwd,
    timeout: params.timeout || 120000,
  })

  let output = result.stdout
  if (result.stderr) {
    output += "\n\n[STDERR]\n" + result.stderr
  }

  if (output.length > MAX_OUTPUT_LENGTH) {
    output = output.substring(0, MAX_OUTPUT_LENGTH) + "\n\n... (output truncated)"
  }

  return {
    title: `[${vpsInfo.nickname}] ${params.command.substring(0, 50)}${params.command.length > 50 ? "..." : ""}`,
    metadata: {
      exitCode: result.exitCode,
      vps: vpsInfo.nickname,
      host: vpsInfo.host,
    },
    output: output || "(no output)",
  }
}

async function readFile(params: { path: string; vps?: string }, ctx: any) {
  const vpsId = await getVpsId(params.vps)
  const vpsInfo = VpsConnection.get(vpsId)!

  await ctx.ask({
    permission: "read",
    patterns: [`[VPS:${vpsInfo.nickname}] ${params.path}`],
    always: ["*"],
    metadata: {
      vps: vpsInfo.nickname,
      path: params.path,
    },
  })

  log.info("Reading VPS file", { vpsId, path: params.path })

  const content = await VpsSftp.readFile(vpsId, params.path)

  // Format with line numbers like the local read tool
  const lines = content.split("\n")
  const numbered = lines.map((line, i) => `${(i + 1).toString().padStart(5, "0")}| ${line}`)

  let output = `<file vps="${vpsInfo.nickname}">\n`
  output += numbered.join("\n")
  output += `\n\n(End of file - total ${lines.length} lines)`
  output += "\n</file>"

  return {
    title: `[${vpsInfo.nickname}] ${params.path}`,
    metadata: {
      vps: vpsInfo.nickname,
      path: params.path,
      lines: lines.length,
    },
    output,
  }
}

async function writeFile(params: { path: string; content: string; vps?: string }, ctx: any) {
  const vpsId = await getVpsId(params.vps)
  const vpsInfo = VpsConnection.get(vpsId)!

  await ctx.ask({
    permission: "edit",
    patterns: [`[VPS:${vpsInfo.nickname}] ${params.path}`],
    always: ["*"],
    metadata: {
      vps: vpsInfo.nickname,
      path: params.path,
      bytes: params.content.length,
    },
  })

  log.info("Writing VPS file", { vpsId, path: params.path, bytes: params.content.length })

  await VpsSftp.writeFile(vpsId, params.path, params.content)

  return {
    title: `[${vpsInfo.nickname}] Write ${params.path}`,
    metadata: {
      vps: vpsInfo.nickname,
      path: params.path,
      bytes: params.content.length,
    },
    output: `Successfully wrote ${params.content.length} bytes to ${params.path} on ${vpsInfo.nickname}`,
  }
}

async function listDirectory(params: { path?: string; vps?: string }, ctx: any) {
  const vpsId = await getVpsId(params.vps)
  const vpsInfo = VpsConnection.get(vpsId)!
  const dirPath = params.path || "."

  await ctx.ask({
    permission: "glob",
    patterns: [`[VPS:${vpsInfo.nickname}] ${dirPath}`],
    always: ["*"],
    metadata: {
      vps: vpsInfo.nickname,
      path: dirPath,
    },
  })

  log.info("Listing VPS directory", { vpsId, path: dirPath })

  const files = await VpsSftp.listDirectory(vpsId, dirPath)

  const output = files
    .map((f) => {
      const typeChar = f.isDirectory ? "d" : f.isSymlink ? "l" : "-"
      const size = f.isDirectory ? "-" : f.size.toString()
      return `${typeChar} ${size.padStart(10)} ${f.name}`
    })
    .join("\n")

  return {
    title: `[${vpsInfo.nickname}] ls ${dirPath}`,
    metadata: {
      vps: vpsInfo.nickname,
      path: dirPath,
      count: files.length,
    },
    output: output || "(empty directory)",
  }
}

async function switchContext(params: { target: string }, ctx: any) {
  if (params.target === "local") {
    VpsContext.switchToLocal()
    return {
      title: "Switch to local",
      metadata: { context: "local" },
      output: "Switched to local context. Commands will now execute locally.",
    }
  }

  // Connect to VPS if not already connected
  const existing = VpsConnection.getByKey(params.target)
  let vpsId: string
  let nickname: string

  if (existing && existing.status === "connected") {
    vpsId = existing.id
    nickname = existing.nickname
  } else {
    const config = await Config.get()
    const vpsConfig = config.vps?.[params.target]
    if (!vpsConfig) {
      throw new Error(`VPS '${params.target}' not found. Available: ${Object.keys(config.vps || {}).join(", ")}`)
    }

    const info = await VpsConnection.connect(params.target, vpsConfig)
    vpsId = info.id
    nickname = info.nickname
  }

  VpsContext.switchToVps(vpsId, params.target, nickname)

  return {
    title: `Switch to ${nickname}`,
    metadata: {
      context: "vps",
      vps: params.target,
      nickname,
    },
    output: `Switched to VPS: ${nickname}. Commands will now execute on the remote server.`,
  }
}

async function getStatus(ctx: any) {
  const context = VpsContext.getCurrent()
  const connections = VpsConnection.list()
  const config = await Config.get()
  const configured = Object.keys(config.vps || {})

  const lines = ["VPS Status", ""]

  lines.push("Current Context:")
  if (context.type === "local") {
    lines.push("  Local")
  } else {
    const vpsInfo = VpsConnection.get(context.vpsId!)
    lines.push(`  VPS: ${context.nickname} (${vpsInfo?.user}@${vpsInfo?.host})`)
  }
  lines.push("")

  lines.push("Configured VPS:")
  for (const key of configured) {
    const cfg = config.vps![key]
    const conn = connections.find((c) => c.configKey === key)
    const status = conn?.status === "connected" ? "[connected]" : ""
    lines.push(`  - ${key}: ${cfg.user}@${cfg.host} ${status}`)
  }

  if (configured.length === 0) {
    lines.push("  (none configured)")
  }

  lines.push("")
  lines.push("Active Connections:")
  for (const conn of connections) {
    lines.push(`  - ${conn.nickname} (${conn.configKey}): ${conn.status}`)
  }

  if (connections.length === 0) {
    lines.push("  (none)")
  }

  return {
    title: "VPS Status",
    metadata: {
      context: context.type,
      activeConnections: connections.length,
      configuredVps: configured.length,
    },
    output: lines.join("\n"),
  }
}

async function connectVps(params: { vps: string; password?: string }, ctx: any) {
  const config = await Config.get()
  const vpsConfig = config.vps?.[params.vps]

  if (!vpsConfig) {
    throw new Error(`VPS '${params.vps}' not found. Available: ${Object.keys(config.vps || {}).join(", ")}`)
  }

  // Check if already connected
  const existing = VpsConnection.getByKey(params.vps)
  if (existing && existing.status === "connected") {
    return {
      title: `Already connected to ${existing.nickname}`,
      metadata: { vps: params.vps, id: existing.id },
      output: `Already connected to ${existing.nickname} (${existing.user}@${existing.host})`,
    }
  }

  const info = await VpsConnection.connect(params.vps, vpsConfig, { password: params.password })

  return {
    title: `Connected to ${info.nickname}`,
    metadata: { vps: params.vps, id: info.id },
    output: `Successfully connected to ${info.nickname} (${info.user}@${info.host})`,
  }
}

async function disconnectVps(params: { vps?: string }, ctx: any) {
  const context = VpsContext.getCurrent()

  let vpsId: string | undefined
  let nickname: string | undefined

  if (params.vps) {
    const conn = VpsConnection.getByKey(params.vps)
    if (conn) {
      vpsId = conn.id
      nickname = conn.nickname
    }
  } else if (context.type === "vps" && context.vpsId) {
    vpsId = context.vpsId
    nickname = context.nickname
  }

  if (!vpsId) {
    throw new Error("No VPS specified and not in VPS context")
  }

  VpsConnection.disconnect(vpsId)

  // Switch back to local if we were on this VPS
  if (context.type === "vps" && context.vpsId === vpsId) {
    VpsContext.switchToLocal()
  }

  return {
    title: `Disconnected from ${nickname}`,
    metadata: { vps: nickname },
    output: `Disconnected from ${nickname}. Switched to local context.`,
  }
}

import { type Subprocess, type FileSink } from "bun"
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type SessionNotification,
  type ContentBlock,
  type Client,
  type Agent,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type PermissionOption,
  type ToolKind,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
} from "@agentclientprotocol/sdk"
import { Log } from "../../util/log"
import { Config } from "../../config/config"
import { convertAllMcps } from "./mcp-converter"
import { Agent as OpencodeAgent } from "../../agent/agent"
import { Wildcard } from "../../util/wildcard"
import { Filesystem } from "../../util/filesystem"
import { Permission } from "../../permission/index"
import { Instance } from "../../project/instance"
import { Bus } from "../../bus"
import { File } from "../../file"
import { FileTime } from "../../file/time"
import path from "path"

const log = Log.create({ service: "acp-client" })

export interface SessionConfig {
  model?: string
  maxTokens?: number
}

export interface SessionUpdateHandler {
  (update: SessionNotification): void | Promise<void>
}

/**
 * ACPClient manages the subprocess and JSON-RPC communication with an ACP agent
 */
export class ACPClient {
  private subprocess: Subprocess | null = null
  private connection: ClientSideConnection | null = null
  private updateHandlers: Set<SessionUpdateHandler> = new Set()
  private command: string
  private args: string[]
  private permissionConfig?: OpencodeAgent.Info["permission"]
  private sessionContext?: {
    sessionID: string
    messageID: string
    agentName: string
  }

  constructor(
    command: string,
    args: string[],
    permissionConfig?: OpencodeAgent.Info["permission"],
    sessionContext?: { sessionID: string; messageID: string; agentName: string },
  ) {
    this.command = command
    this.args = args
    this.permissionConfig = permissionConfig
    this.sessionContext = sessionContext
  }

  /**
   * Initialize the subprocess and ACP connection
   */
  async initialize(): Promise<void> {
    using _ = log.time("initialize", { command: this.command })

    try {
      // Spawn the subprocess
      this.subprocess = Bun.spawn([this.command, ...this.args], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
        env: process.env,
      })

      if (!this.subprocess.stdin || !this.subprocess.stdout) {
        throw new Error("Failed to get subprocess stdio")
      }

      // Bun's subprocess.stdout is a ReadableStream, but stdin is a FileSink
      // We need to convert FileSink to WritableStream for ndJsonStream
      const stdin = this.subprocess.stdin as FileSink
      const stdinStream = new WritableStream<Uint8Array>({
        async write(chunk) {
          stdin.write(chunk)
          await stdin.flush()
        },
        async close() {
          await stdin.end()
        },
      })

      // ndJsonStream expects: ndJsonStream(output: WritableStream, input: ReadableStream)
      // output = where we write TO (stdin), input = where we read FROM (stdout)
      const stream = ndJsonStream(stdinStream, this.subprocess.stdout as ReadableStream<Uint8Array>)

      // Capture this for use in callbacks
      const updateHandlers = this.updateHandlers
      const permissionConfig = this.permissionConfig
      const sessionContext = this.sessionContext

      // Create the ACP connection with a Client implementation
      this.connection = new ClientSideConnection((_agent: Agent) => {
        // Return a minimal Client implementation
        const client: Client = {
          // Handle session updates from the agent
          async sessionUpdate(notification: SessionNotification) {
            for (const handler of updateHandlers) {
              try {
                const result = handler(notification)
                if (result instanceof Promise) {
                  await result.catch((error) => {
                    log.error("Update handler error", { error })
                  })
                }
              } catch (error) {
                log.error("Update handler error", { error })
              }
            }
          },
          async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
            const toolKind = params.toolCall.kind
            const rawInput = params.toolCall.rawInput || {}

            const permType = getPermissionType(toolKind, rawInput)
            if (!permType) {
              return await promptUserPermission(params, updateHandlers, sessionContext, {
                type: "acp_unknown",
                title: `Unknown ACP tool: ${toolKind}`,
                metadata: { toolKind, rawInput },
              })
            }

            if (permType.type === "bash") {
              const command = (rawInput.command as string) || ""
              const bashPerms = permissionConfig?.bash

              if (!bashPerms) {
                return await promptUserPermission(params, updateHandlers, sessionContext, {
                  type: "bash",
                  pattern: [command],
                  title: `Execute: ${command}`,
                  metadata: { command },
                })
              }

              const parts = command.trim().split(/\s+/)
              const head = parts[0]
              const tail = parts.slice(1)
              const action = Wildcard.allStructured({ head, tail }, bashPerms)

              return await handlePermissionAction(action, params, updateHandlers, sessionContext, {
                type: "bash",
                pattern: [command],
                title: `Execute: ${command}`,
                metadata: { command },
              })
            }

            if (permType.type === "read" && permType.filePath) {
              const absolutePath = path.isAbsolute(permType.filePath)
                ? permType.filePath
                : path.join(Instance.directory, permType.filePath)

              const isExternal = !Filesystem.contains(Instance.directory, absolutePath)

              if (isExternal) {
                const externalDirPerm = permissionConfig?.external_directory || "ask"
                const parentDir = path.dirname(absolutePath)

                return await handlePermissionAction(externalDirPerm, params, updateHandlers, sessionContext, {
                  type: "external_directory",
                  pattern: [parentDir, path.join(parentDir, "*")],
                  title: `Access external file: ${permType.filePath}`,
                  metadata: { filepath: permType.filePath, parentDir },
                })
              }
            }

            const configKey = permType.type as keyof OpencodeAgent.Info["permission"]
            const permModeLookup = permissionConfig?.[configKey]
            const permMode =
              typeof permModeLookup === "string" || typeof permModeLookup === "undefined"
                ? permModeLookup || "ask"
                : "ask"

            return await handlePermissionAction(permMode, params, updateHandlers, sessionContext, {
              type: permType.type,
              title: `${toolKind} tool`,
              metadata: { toolKind, rawInput },
            })
          },
          async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
            const filePath = path.isAbsolute(params.path)
              ? params.path
              : path.join(Instance.directory, params.path)

            const isExternal = !Filesystem.contains(Instance.directory, filePath)
            if (isExternal) {
              const externalDirPerm = permissionConfig?.external_directory || "ask"
              const parentDir = path.dirname(filePath)

              if (externalDirPerm === "deny") {
                throw new Error(`Permission denied: cannot read external file ${params.path}`)
              } else if (externalDirPerm === "ask" && sessionContext) {
                const callID = `acp-read-${Date.now()}`
                await Permission.ask({
                  type: "external_directory",
                  pattern: [parentDir, path.join(parentDir, "*")],
                  sessionID: sessionContext.sessionID,
                  messageID: sessionContext.messageID,
                  callID,
                  title: `Read external file: ${params.path}`,
                  metadata: { filepath: params.path, parentDir },
                })
              }
            }

            const file = Bun.file(filePath)
            const exists = await file.exists()
            if (!exists) {
              throw new Error(`File not found: ${filePath}`)
            }

            const content = await file.text()

            if (sessionContext) {
              FileTime.read(sessionContext.sessionID, filePath)
            }

            return { content }
          },
          async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
            const filePath = path.isAbsolute(params.path)
              ? params.path
              : path.join(Instance.directory, params.path)

            const file = Bun.file(filePath)
            const exists = await file.exists()
            const isExternal = !Filesystem.contains(Instance.directory, filePath)

            if (isExternal) {
              const externalDirPerm = permissionConfig?.external_directory || "ask"
              const parentDir = path.dirname(filePath)

              if (externalDirPerm === "deny") {
                throw new Error(`Permission denied: cannot write to external file ${params.path}`)
              } else if (externalDirPerm === "ask" && sessionContext) {
                const callID = `acp-write-${Date.now()}`
                await Permission.ask({
                  type: "external_directory",
                  pattern: [parentDir, path.join(parentDir, "*")],
                  sessionID: sessionContext.sessionID,
                  messageID: sessionContext.messageID,
                  callID,
                  title: `Write to external file: ${params.path}`,
                  metadata: { filepath: params.path, parentDir },
                })
              }
            } else {
              const editPerm = permissionConfig?.edit || "ask"

              if (editPerm === "deny") {
                throw new Error(`Permission denied: cannot write to file ${params.path}`)
              } else if (editPerm === "ask" && sessionContext) {
                const callID = `acp-write-${Date.now()}`
                await Permission.ask({
                  type: "write",
                  sessionID: sessionContext.sessionID,
                  messageID: sessionContext.messageID,
                  callID,
                  title: exists ? `Overwrite file: ${params.path}` : `Create file: ${params.path}`,
                  metadata: {
                    filePath: params.path,
                    content: params.content,
                    exists,
                  },
                })
              }
            }

            const parentDir = path.dirname(filePath)
            const parentFile = Bun.file(parentDir)
            const parentExists = await parentFile.exists()
            if (!parentExists) {
              await Bun.spawn(["mkdir", "-p", parentDir]).exited
            }

            await Bun.write(filePath, params.content)
            await Bus.publish(File.Event.Edited, { file: filePath })

            if (sessionContext) {
              FileTime.read(sessionContext.sessionID, filePath)
            }

            return {}
          },
        }
        return client
      }, stream)

      // Initialize the connection
      const initResult = await this.connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: {
          name: "opencode",
          version: "1.0.0",
        },
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
        },
      })

      log.info("ACP connection initialized", {
        agentInfo: initResult.agentInfo,
        agentCapabilities: initResult.agentCapabilities,
      })
    } catch (error) {
      await this.cleanup()
      log.error("Failed to initialize ACP client", { error })
      throw new Error(
        `Failed to initialize ACP client: ${error instanceof Error ? error.message : JSON.stringify(error)}`,
      )
    }
  }

  /**
   * Create a new ACP session
   */
  async createSession(_config: SessionConfig): Promise<string> {
    if (!this.connection) {
      throw new Error("Client not initialized")
    }

    using _ = log.time("createSession")

    // Fetch and convert OpenCode MCPs to ACP format
    const openCodeConfig = await Config.get()
    const mcpServers = openCodeConfig.mcp ? convertAllMcps(openCodeConfig.mcp) : []

    log.info("Creating session with MCPs", {
      mcpCount: mcpServers.length,
      mcps: mcpServers.map((m) => ({ name: m.name, type: "type" in m ? m.type : "stdio" })),
    })

    const result = await this.connection.newSession({
      cwd: process.cwd(),
      mcpServers,
    })

    log.info("Session created", { sessionId: result.sessionId })
    return result.sessionId
  }

  /**
   * Send a message (prompt) to the ACP agent
   */
  async sendMessage(sessionId: string, content: ContentBlock[]): Promise<PromptResponse> {
    if (!this.connection) {
      throw new Error("Client not initialized")
    }

    using _ = log.time("sendMessage", { sessionId })

    const response = await this.connection.prompt({
      sessionId,
      prompt: content,
    })

    return response
  }

  /**
   * Register a handler for session updates
   */
  onUpdate(handler: SessionUpdateHandler): () => void {
    this.updateHandlers.add(handler)
    return () => {
      this.updateHandlers.delete(handler)
    }
  }

  /**
   * Close a session
   */
  async closeSession(sessionId: string): Promise<void> {
    if (!this.connection) {
      return
    }

    try {
      using _ = log.time("closeSession", { sessionId })
      // ACP SDK doesn't have explicit close session, sessions are managed by the agent
      // We just log the intent
      log.info("Session closed", { sessionId })
    } catch (error) {
      log.error("Error closing session", { error, sessionId })
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    using _ = log.time("cleanup")

    this.updateHandlers.clear()

    if (this.connection) {
      try {
        // Wait for the connection to close
        // ClientSideConnection doesn't have a close() method, just a closed promise
        // The connection will close when the subprocess is killed
      } catch (error) {
        log.error("Error closing connection", { error })
      }
      this.connection = null
    }

    if (this.subprocess) {
      try {
        // Kill the subprocess
        this.subprocess.kill()
        // Wait for it to exit
        await this.subprocess.exited
      } catch (error) {
        log.error("Error killing subprocess", { error })
      }
      this.subprocess = null
    }
  }

  /**
   * Check if the subprocess is still running
   */
  isAlive(): boolean {
    return this.subprocess !== null && !this.subprocess.killed
  }
}

function getPermissionType(
  kind: ToolKind | undefined | null,
  rawInput: Record<string, any>,
): { type: string; filePath?: string } | null {
  switch (kind) {
    case "execute":
      return { type: "bash" }
    case "edit":
      return { type: "edit" }
    case "fetch":
      return { type: "webfetch" }
    case "read":
      const filePath = rawInput.filePath || rawInput.path
      return { type: "read", filePath }
    default:
      return null
  }
}

async function handlePermissionAction(
  action: Config.Permission,
  params: RequestPermissionRequest,
  updateHandlers: Set<SessionUpdateHandler>,
  sessionContext:
    | {
        sessionID: string
        messageID: string
        agentName: string
      }
    | undefined,
  permissionInfo: {
    type: string
    pattern?: string[]
    title: string
    metadata: Record<string, any>
  },
): Promise<RequestPermissionResponse> {
  switch (action) {
    case "allow":
      return selectAllowOption(params.options, "allow_once")

    case "deny":
      return { outcome: { outcome: "cancelled" as const } }

    case "ask":
      return await promptUserPermission(params, updateHandlers, sessionContext, permissionInfo)
  }
}

async function promptUserPermission(
  params: RequestPermissionRequest,
  updateHandlers: Set<SessionUpdateHandler>,
  sessionContext:
    | {
        sessionID: string
        messageID: string
        agentName: string
      }
    | undefined,
  permissionInfo: {
    type: string
    pattern?: string[]
    title: string
    metadata: Record<string, any>
  },
): Promise<RequestPermissionResponse> {
  if (!sessionContext) {
    return selectAllowOption(params.options, "allow_once")
  }

  const callID = `acp-${Date.now()}`

  try {
    await Permission.ask({
      type: permissionInfo.type,
      pattern: permissionInfo.pattern,
      sessionID: sessionContext.sessionID,
      messageID: sessionContext.messageID,
      callID,
      title: permissionInfo.title,
      metadata: permissionInfo.metadata,
    })

    const isAlways = false

    return selectAllowOption(params.options, isAlways ? "allow_always" : "allow_once")
  } catch (error) {
    if (error instanceof Permission.RejectedError) {
      return { outcome: { outcome: "cancelled" as const } }
    }
    throw error
  }
}

function selectAllowOption(
  options: PermissionOption[],
  preference: "allow_once" | "allow_always",
): RequestPermissionResponse {
  const preferred = options.find((opt) => opt.kind === preference)
  const fallback = options.find((opt) => opt.kind === "allow_once" || opt.kind === "allow_always")
  const selected = preferred || fallback

  if (!selected) {
    return { outcome: { outcome: "cancelled" as const } }
  }

  return {
    outcome: {
      outcome: "selected" as const,
      optionId: selected.optionId,
    },
  }
}

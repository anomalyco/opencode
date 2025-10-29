import {
  type Agent as ACPAgent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type CancelNotification,
  type InitializeRequest,
  type LoadSessionRequest,
  type NewSessionRequest,
  type PermissionOption,
  type PlanEntry,
  type PromptRequest,
  type SetSessionModelRequest,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type ToolCallContent,
  type ToolKind,
} from "@agentclientprotocol/sdk"
import { Log } from "../util/log"
import { ACPSessionManager } from "./session"
import type { ACPConfig } from "./types"
import { Provider } from "../provider/provider"
import { SessionPrompt } from "../session/prompt"
import { Installation } from "@/installation"
import { SessionLock } from "@/session/lock"
import { Bus } from "@/bus"
import { MessageV2 } from "@/session/message-v2"
import { Storage } from "@/storage/storage"
import { Command } from "@/command"
import { Agent as Agents } from "@/agent/agent"
import { Permission } from "@/permission"
import { Session } from "@/session"
import { Identifier } from "@/id/id"
import { SessionCompaction } from "@/session/compaction"
import type { Config } from "@/config/config"
import { MCP } from "@/mcp"
import { Todo } from "@/session/todo"
import { z } from "zod"

export namespace ACP {
  const log = Log.create({ service: "acp-agent" })

  export class Agent implements ACPAgent {
    private sessionManager = new ACPSessionManager()
    private connection: AgentSideConnection
    private config: ACPConfig

    constructor(connection: AgentSideConnection, config: ACPConfig = {}) {
      this.connection = connection
      this.config = config
      this.setupEventSubscriptions()
    }

    private setupEventSubscriptions() {
      const options: PermissionOption[] = [
        { optionId: "once", kind: "allow_once", name: "Allow once" },
        { optionId: "always", kind: "allow_always", name: "Always allow" },
        { optionId: "reject", kind: "reject_once", name: "Reject" },
      ]
      Bus.subscribe(Permission.Event.Updated, async (event) => {
        const acpSession = this.sessionManager.get(event.properties.sessionID)
        if (!acpSession) return
        try {
          const permission = event.properties
          const res = await this.connection
            .requestPermission({
              sessionId: acpSession.id,
              toolCall: {
                toolCallId: permission.callID ?? permission.id,
                status: "pending",
                title: permission.title,
                rawInput: permission.metadata,
                kind: toToolKind(permission.type),
                locations: toLocations(permission.type, permission.metadata),
              },
              options,
            })
            .catch((error) => {
              log.error("failed to request permission from ACP", {
                error,
                permissionID: permission.id,
                sessionID: permission.sessionID,
              })
              Permission.respond({
                sessionID: permission.sessionID,
                permissionID: permission.id,
                response: "reject",
              })
              return
            })
          if (!res) return
          if (res.outcome.outcome !== "selected") {
            Permission.respond({ sessionID: permission.sessionID, permissionID: permission.id, response: "reject" })
            return
          }
          Permission.respond({
            sessionID: permission.sessionID,
            permissionID: permission.id,
            response: res.outcome.optionId as "once" | "always" | "reject",
          })
        } catch (err) {
          if (!(err instanceof Permission.RejectedError)) {
            log.error("unexpected error when handling permission", { error: err })
            throw err
          }
        }
      })

      Bus.subscribe(MessageV2.Event.PartUpdated, async (event) => {
        const props = event.properties
        const { part } = props
        const acpSession = this.sessionManager.get(part.sessionID)
        if (!acpSession) return

        const message = await Storage.read<MessageV2.Info>(["message", part.sessionID, part.messageID]).catch(
          () => undefined,
        )
        if (!message || message.role !== "assistant") return

        if (part.type === "tool") {
          switch (part.state.status) {
            case "pending":
              await this.connection
                .sessionUpdate({
                  sessionId: acpSession.id,
                  update: {
                    sessionUpdate: "tool_call",
                    toolCallId: part.callID,
                    title: part.tool,
                    kind: toToolKind(part.tool),
                    status: "pending",
                    locations: [],
                    rawInput: {},
                  },
                })
                .catch((err) => {
                  log.error("failed to send tool pending to ACP", { error: err })
                })
              break
            case "running":
              await this.connection
                .sessionUpdate({
                  sessionId: acpSession.id,
                  update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: part.callID,
                    status: "in_progress",
                    locations: toLocations(part.tool, part.state.input),
                    rawInput: part.state.input,
                  },
                })
                .catch((err) => {
                  log.error("failed to send tool in_progress to ACP", { error: err })
                })
              break
            case "completed":
              const kind = toToolKind(part.tool)
              const content: ToolCallContent[] = [
                {
                  type: "content",
                  content: {
                    type: "text",
                    text: part.state.output,
                  },
                },
              ]

              if (kind === "edit") {
                const input = part.state.input
                const filePath = typeof input["filePath"] === "string" ? input["filePath"] : ""
                const oldText = typeof input["oldString"] === "string" ? input["oldString"] : ""
                const newText =
                  typeof input["newString"] === "string"
                    ? input["newString"]
                    : typeof input["content"] === "string"
                      ? input["content"]
                      : ""
                content.push({
                  type: "diff",
                  path: filePath,
                  oldText,
                  newText,
                })
              }

              if (part.tool === "todowrite") {
                const parsedTodos = z.array(Todo.Info).safeParse(JSON.parse(part.state.output))
                if (parsedTodos.success) {
                  await this.connection
                    .sessionUpdate({
                      sessionId: acpSession.id,
                      update: {
                        sessionUpdate: "plan",
                        entries: parsedTodos.data.map((todo) => {
                          const status: PlanEntry["status"] =
                            todo.status === "cancelled" ? "completed" : (todo.status as PlanEntry["status"])
                          return {
                            priority: "medium",
                            status,
                            content: todo.content,
                          }
                        }),
                      },
                    })
                    .catch((err) => {
                      log.error("failed to send session update for todo", { error: err })
                    })
                } else {
                  log.error("failed to parse todo output", { error: parsedTodos.error })
                }
              }

              await this.connection
                .sessionUpdate({
                  sessionId: acpSession.id,
                  update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: part.callID,
                    status: "completed",
                    kind,
                    content,
                    title: part.state.title,
                    rawOutput: {
                      output: part.state.output,
                      metadata: part.state.metadata,
                    },
                  },
                })
                .catch((err) => {
                  log.error("failed to send tool completed to ACP", { error: err })
                })
              break
            case "error":
              await this.connection
                .sessionUpdate({
                  sessionId: acpSession.id,
                  update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: part.callID,
                    status: "failed",
                    content: [
                      {
                        type: "content",
                        content: {
                          type: "text",
                          text: part.state.error,
                        },
                      },
                    ],
                    rawOutput: {
                      error: part.state.error,
                    },
                  },
                })
                .catch((err) => {
                  log.error("failed to send tool error to ACP", { error: err })
                })
              break
          }
        } else if (part.type === "text") {
          const delta = props.delta
          if (delta && part.synthetic !== true) {
            await this.connection
              .sessionUpdate({
                sessionId: acpSession.id,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: {
                    type: "text",
                    text: delta,
                  },
                },
              })
              .catch((err) => {
                log.error("failed to send text to ACP", { error: err })
              })
          }
        } else if (part.type === "reasoning") {
          const delta = props.delta
          if (delta) {
            await this.connection
              .sessionUpdate({
                sessionId: acpSession.id,
                update: {
                  sessionUpdate: "agent_thought_chunk",
                  content: {
                    type: "text",
                    text: delta,
                  },
                },
              })
              .catch((err) => {
                log.error("failed to send reasoning to ACP", { error: err })
              })
          }
        }
      })
    }

    async initialize(params: InitializeRequest) {
      log.info("initialize", { protocolVersion: params.protocolVersion })

      return {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          mcpCapabilities: {
            http: true,
            sse: true,
          },
          promptCapabilities: {
            embeddedContext: true,
            image: true,
          },
        },
        authMethods: [
          {
            description: "Run `opencode auth login` in the terminal",
            name: "Login with opencode",
            id: "opencode-login",
          },
        ],
        _meta: {
          opencode: {
            version: Installation.VERSION,
          },
        },
      }
    }

    async authenticate(_params: AuthenticateRequest) {
      throw new Error("Authentication not implemented")
    }

    async newSession(params: NewSessionRequest) {
      const model = await defaultModel(this.config)
      const session = await this.sessionManager.create(params.cwd, params.mcpServers, model)

      log.info("creating_session", { mcpServers: params.mcpServers.length })
      const load = await this.loadSession({
        cwd: params.cwd,
        mcpServers: params.mcpServers,
        sessionId: session.id,
      })

      return {
        sessionId: session.id,
        models: load.models,
        modes: load.modes,
        _meta: {},
      }
    }

    async loadSession(params: LoadSessionRequest) {
      const model = await defaultModel(this.config)
      const sessionId = params.sessionId

      const providers = await Provider.list()
      const entries = Object.entries(providers).sort((a, b) => {
        const nameA = a[1].info.name.toLowerCase()
        const nameB = b[1].info.name.toLowerCase()
        if (nameA < nameB) return -1
        if (nameA > nameB) return 1
        return 0
      })
      const availableModels = entries.flatMap(([providerID, provider]) => {
        const models = Provider.sort(Object.values(provider.info.models))
        return models.map((model) => ({
          modelId: `${providerID}/${model.id}`,
          name: `${provider.info.name}/${model.name}`,
        }))
      })

      const availableCommands = (await Command.list()).map((command) => ({
        name: command.name,
        description: command.description ?? "",
      }))
      const names = new Set(availableCommands.map((c) => c.name))
      if (!names.has("init"))
        availableCommands.push({
          name: "init",
          description: "create/update a AGENTS.md",
        })
      if (!names.has("compact"))
        availableCommands.push({
          name: "compact",
          description: "compact the session",
        })

      setTimeout(() => {
        this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands,
          },
        })
      }, 0)

      const availableModes = (await Agents.list())
        .filter((agent) => agent.mode !== "subagent")
        .map((agent) => ({
          id: agent.name,
          name: agent.name,
          description: agent.description,
        }))

      const currentModeId = availableModes.find((m) => m.name === "build")?.id ?? availableModes[0].id

      const mcpServers: Record<string, Config.Mcp> = {}
      for (const server of params.mcpServers) {
        if ("type" in server) {
          mcpServers[server.name] = {
            url: server.url,
            headers: server.headers.reduce<Record<string, string>>((acc, { name, value }) => {
              acc[name] = value
              return acc
            }, {}),
            type: "remote",
          }
        } else {
          mcpServers[server.name] = {
            type: "local",
            command: [server.command, ...server.args],
            environment: server.env.reduce<Record<string, string>>((acc, { name, value }) => {
              acc[name] = value
              return acc
            }, {}),
          }
        }
      }

      await Promise.all(
        Object.entries(mcpServers).map(async ([key, mcp]) => {
          await MCP.add(key, mcp)
        }),
      )

      return {
        sessionId,
        models: {
          currentModelId: `${model.providerID}/${model.modelID}`,
          availableModels,
        },
        modes: {
          availableModes,
          currentModeId,
        },
        _meta: {},
      }
    }

    async setSessionModel(params: SetSessionModelRequest) {
      const session = this.sessionManager.get(params.sessionId)
      if (!session) {
        throw new Error(`Session not found: ${params.sessionId}`)
      }

      const parsed = Provider.parseModel(params.modelId)
      const model = await Provider.getModel(parsed.providerID, parsed.modelID)

      this.sessionManager.setModel(session.id, {
        providerID: model.providerID,
        modelID: model.modelID,
      })

      return {
        _meta: {},
      }
    }

    async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse | void> {
      const session = this.sessionManager.get(params.sessionId)
      if (!session) {
        throw new Error(`Session not found: ${params.sessionId}`)
      }
      await Agents.get(params.modeId).then((agent) => {
        if (!agent) throw new Error(`Agent not found: ${params.modeId}`)
      })
      this.sessionManager.setMode(params.sessionId, params.modeId)
    }

    async prompt(params: PromptRequest) {
      const sessionID = params.sessionId
      const acpSession = this.sessionManager.get(sessionID)
      if (!acpSession) {
        throw new Error(`Session not found: ${sessionID}`)
      }

      const current = acpSession.model
      const model = current ?? (await defaultModel(this.config))
      if (!current) {
        this.sessionManager.setModel(acpSession.id, model)
      }
      const agent = acpSession.modeId ?? "build"

      const parts: SessionPrompt.PromptInput["parts"] = []
      for (const part of params.prompt) {
        switch (part.type) {
          case "text":
            parts.push({
              type: "text" as const,
              text: part.text,
            })
            break
          case "image":
            if (part.data) {
              parts.push({
                type: "file",
                url: `data:${part.mimeType};base64,${part.data}`,
                mime: part.mimeType,
              })
            } else if (part.uri && part.uri.startsWith("http:")) {
              parts.push({
                type: "file",
                url: part.uri,
                mime: part.mimeType,
              })
            }
            break

          case "resource_link":
            const parsed = parseUri(part.uri)
            parts.push(parsed)

            break

          case "resource":
            const resource = part.resource
            if ("text" in resource) {
              parts.push({
                type: "text",
                text: resource.text,
              })
            }
            break

          default:
            break
        }
      }

      log.info("parts", { parts })

      const cmd = (() => {
        const text = parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("")
          .trim()

        if (!text.startsWith("/")) return

        const [name, ...rest] = text.slice(1).split(/\s+/)
        return { name, args: rest.join(" ").trim() }
      })()

      const done = {
        stopReason: "end_turn" as const,
        _meta: {},
      }

      if (!cmd) {
        await SessionPrompt.prompt({
          sessionID,
          model: {
            providerID: model.providerID,
            modelID: model.modelID,
          },
          parts,
          agent,
        })
        return done
      }

      const command = await Command.get(cmd.name)
      if (command) {
        await SessionPrompt.command({
          sessionID,
          command: command.name,
          arguments: cmd.args,
          model: model.providerID + "/" + model.modelID,
          agent,
        })
        return done
      }

      switch (cmd.name) {
        case "init":
          await Session.initialize({
            sessionID,
            messageID: Identifier.ascending("message"),
            providerID: model.providerID,
            modelID: model.modelID,
          })
          break
        case "compact":
          await SessionCompaction.run({
            sessionID,
            providerID: model.providerID,
            modelID: model.modelID,
          })
          break
      }

      return done
    }

    async cancel(params: CancelNotification) {
      SessionLock.abort(params.sessionId)
    }
  }

  function toToolKind(toolName: string): ToolKind {
    const tool = toolName.toLocaleLowerCase()
    switch (tool) {
      case "bash":
        return "execute"
      case "webfetch":
        return "fetch"

      case "edit":
      case "patch":
      case "write":
        return "edit"

      case "grep":
      case "glob":
      case "context7_resolve_library_id":
      case "context7_get_library_docs":
        return "search"

      case "list":
      case "read":
        return "read"

      default:
        return "other"
    }
  }

  function toLocations(toolName: string, input: Record<string, any>): { path: string }[] {
    const tool = toolName.toLocaleLowerCase()
    switch (tool) {
      case "read":
      case "edit":
      case "write":
        return input["filePath"] ? [{ path: input["filePath"] }] : []
      case "glob":
      case "grep":
        return input["path"] ? [{ path: input["path"] }] : []
      case "bash":
        return []
      case "list":
        return input["path"] ? [{ path: input["path"] }] : []
      default:
        return []
    }
  }

  async function defaultModel(config: ACPConfig) {
    const configured = config.defaultModel
    if (configured) return configured
    return Provider.defaultModel()
  }

  function parseUri(
    uri: string,
  ): { type: "file"; url: string; filename: string; mime: string } | { type: "text"; text: string } {
    try {
      if (uri.startsWith("file://")) {
        const path = uri.slice(7)
        const name = path.split("/").pop() || path
        return {
          type: "file",
          url: uri,
          filename: name,
          mime: "text/plain",
        }
      }
      if (uri.startsWith("zed://")) {
        const url = new URL(uri)
        const path = url.searchParams.get("path")
        if (path) {
          const name = path.split("/").pop() || path
          return {
            type: "file",
            url: `file://${path}`,
            filename: name,
            mime: "text/plain",
          }
        }
      }
      return {
        type: "text",
        text: uri,
      }
    } catch {
      return {
        type: "text",
        text: uri,
      }
    }
  }
}

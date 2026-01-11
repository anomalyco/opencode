import {
  RequestError,
  type Agent as ACPAgent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type AuthMethod,
  type CancelNotification,
  type InitializeRequest,
  type InitializeResponse,
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
import type { ACPConfig, ACPSessionState } from "./types"
import { Provider } from "../provider/provider"
import { Agent as AgentModule } from "../agent/agent"
import { Installation } from "@/installation"
import { MessageV2 } from "@/session/message-v2"
import { Config } from "@/config/config"
import { Todo } from "@/session/todo"
import { z } from "zod"
import { LoadAPIKeyError } from "ai"
import type { OpencodeClient, SessionMessageResponse } from "@opencode-ai/sdk/v2"
import { applyPatch } from "diff"

export namespace ACP {
  const log = Log.create({ service: "acp-agent" })

  export async function init({ sdk: _sdk }: { sdk: OpencodeClient }) {
    return {
      create: (connection: AgentSideConnection, fullConfig: ACPConfig) => {
        return new Agent(connection, fullConfig)
      },
    }
  }

  export class Agent implements ACPAgent {
    private connection: AgentSideConnection
    private config: ACPConfig
    private sdk: OpencodeClient
    private sessionManager

    constructor(connection: AgentSideConnection, config: ACPConfig) {
      this.connection = connection
      this.config = config
      this.sdk = config.sdk
      this.sessionManager = new ACPSessionManager(this.sdk)
    }

    private setupEventSubscriptions(session: ACPSessionState) {
      const sessionId = session.id
      const directory = session.cwd

      const options: PermissionOption[] = [
        { optionId: "once", kind: "allow_once", name: "Allow once" },
        { optionId: "always", kind: "allow_always", name: "Always allow" },
        { optionId: "reject", kind: "reject_once", name: "Reject" },
      ]
      this.config.sdk.event.subscribe({ directory }).then(async (events) => {
        for await (const event of events.stream) {
          switch (event.type) {
            case "permission.asked":
              try {
                const permission = event.properties
                const res = await this.connection
                  .requestPermission({
                    sessionId,
                    toolCall: {
                      toolCallId: permission.tool?.callID ?? permission.id,
                      status: "pending",
                      title: permission.permission,
                      rawInput: permission.metadata,
                      kind: toToolKind(permission.permission),
                      locations: toLocations(permission.permission, permission.metadata),
                    },
                    options,
                  })
                  .catch(async (error) => {
                    log.error("failed to request permission from ACP", {
                      error,
                      permissionID: permission.id,
                      sessionID: permission.sessionID,
                    })
                    await this.config.sdk.permission.reply({
                      requestID: permission.id,
                      reply: "reject",
                      directory,
                    })
                    return
                  })
                if (!res) return
                if (res.outcome.outcome !== "selected") {
                  await this.config.sdk.permission.reply({
                    requestID: permission.id,
                    reply: "reject",
                    directory,
                  })
                  return
                }
                if (res.outcome.optionId !== "reject" && permission.permission == "edit") {
                  const metadata = permission.metadata || {}
                  const filepath = typeof metadata["filepath"] === "string" ? metadata["filepath"] : ""
                  const diff = typeof metadata["diff"] === "string" ? metadata["diff"] : ""

                  const content = await Bun.file(filepath).text()
                  const newContent = getNewContent(content, diff)

                  if (newContent) {
                    this.connection.writeTextFile({
                      sessionId: sessionId,
                      path: filepath,
                      content: newContent,
                    })
                  }
                }
                await this.config.sdk.permission.reply({
                  requestID: permission.id,
                  reply: res.outcome.optionId as "once" | "always" | "reject",
                  directory,
                })
              } catch (err) {
                log.error("unexpected error when handling permission", { error: err })
              } finally {
                break
              }

            case "message.part.updated":
              log.info("message part updated", { event: event.properties })
              try {
                const props = event.properties
                const { part } = props

                const message = await this.config.sdk.session
                  .message(
                    {
                      sessionID: part.sessionID,
                      messageID: part.messageID,
                      directory,
                    },
                    { throwOnError: true },
                  )
                  .then((x) => x.data)
                  .catch((err) => {
                    log.error("unexpected error when fetching message", { error: err })
                    return undefined
                  })

                if (!message || message.info.role !== "assistant") return

                if (part.type === "tool") {
                  switch (part.state.status) {
                    case "pending":
                      await this.connection
                        .sessionUpdate({
                          sessionId,
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
                          sessionId,
                          update: {
                            sessionUpdate: "tool_call_update",
                            toolCallId: part.callID,
                            status: "in_progress",
                            kind: toToolKind(part.tool),
                            title: part.tool,
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
                              sessionId,
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
                          sessionId,
                          update: {
                            sessionUpdate: "tool_call_update",
                            toolCallId: part.callID,
                            status: "completed",
                            kind,
                            content,
                            title: part.state.title,
                            rawInput: part.state.input,
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
                          sessionId,
                          update: {
                            sessionUpdate: "tool_call_update",
                            toolCallId: part.callID,
                            status: "failed",
                            kind: toToolKind(part.tool),
                            title: part.tool,
                            rawInput: part.state.input,
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
                        sessionId,
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
                        sessionId,
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
              } finally {
                break
              }
          }
        }
      })
    }

    async initialize(params: InitializeRequest): Promise<InitializeResponse> {
      log.info("initialize", { protocolVersion: params.protocolVersion })

      const authMethod: AuthMethod = {
        description: "Run `opencode auth login` in the terminal",
        name: "Login with opencode",
        id: "opencode-login",
      }

      // If client supports terminal-auth capability, use that instead.
      if (params.clientCapabilities?._meta?.["terminal-auth"] === true) {
        authMethod._meta = {
          "terminal-auth": {
            command: "opencode",
            args: ["auth", "login"],
            label: "OpenCode Login",
          },
        }
      }

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
        authMethods: [authMethod],
        agentInfo: {
          name: "OpenCode",
          version: Installation.VERSION,
        },
      }
    }

    async authenticate(_params: AuthenticateRequest) {
      throw new Error("Authentication not implemented")
    }

    async newSession(params: NewSessionRequest) {
      const directory = params.cwd
      try {
        const model = await defaultModel(this.config, directory)

        // Store ACP session state
        const state = await this.sessionManager.create(params.cwd, params.mcpServers, model)
        const sessionId = state.id

        log.info("creating_session", { sessionId, mcpServers: params.mcpServers.length })

        const load = await this.loadSessionMode({
          cwd: directory,
          mcpServers: params.mcpServers,
          sessionId,
        })

        this.setupEventSubscriptions(state)

        return {
          sessionId,
          models: load.models,
          modes: load.modes,
          _meta: {},
        }
      } catch (e) {
        const error = MessageV2.fromError(e, {
          providerID: this.config.defaultModel?.providerID ?? "unknown",
        })
        if (LoadAPIKeyError.isInstance(error)) {
          throw RequestError.authRequired()
        }
        throw e
      }
    }

    async loadSession(params: LoadSessionRequest) {
      const directory = params.cwd
      const sessionId = params.sessionId

      try {
        const model = await defaultModel(this.config, directory)

        // Store ACP session state
        const state = await this.sessionManager.load(sessionId, params.cwd, params.mcpServers, model)

        log.info("load_session", { sessionId, mcpServers: params.mcpServers.length })

        const mode = await this.loadSessionMode({
          cwd: directory,
          mcpServers: params.mcpServers,
          sessionId,
        })

        this.setupEventSubscriptions(state)

        // Replay session history
        const messages = await this.sdk.session
          .messages(
            {
              sessionID: sessionId,
              directory,
            },
            { throwOnError: true },
          )
          .then((x) => x.data)
          .catch((err) => {
            log.error("unexpected error when fetching message", { error: err })
            return undefined
          })

        for (const msg of messages ?? []) {
          log.debug("replay message", msg)
          await this.processMessage(msg)
        }

        return mode
      } catch (e) {
        const error = MessageV2.fromError(e, {
          providerID: this.config.defaultModel?.providerID ?? "unknown",
        })
        if (LoadAPIKeyError.isInstance(error)) {
          throw RequestError.authRequired()
        }
        throw e
      }
    }

    private async processMessage(message: SessionMessageResponse) {
      log.debug("process message", message)
      if (message.info.role !== "assistant" && message.info.role !== "user") return
      const sessionId = message.info.sessionID

      for (const part of message.parts) {
        if (part.type === "tool") {
          switch (part.state.status) {
            case "pending":
              await this.connection
                .sessionUpdate({
                  sessionId,
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
                  sessionId,
                  update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: part.callID,
                    status: "in_progress",
                    kind: toToolKind(part.tool),
                    title: part.tool,
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
                      sessionId,
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
                  sessionId,
                  update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: part.callID,
                    status: "completed",
                    kind,
                    content,
                    title: part.state.title,
                    rawInput: part.state.input,
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
                  sessionId,
                  update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: part.callID,
                    status: "failed",
                    kind: toToolKind(part.tool),
                    title: part.tool,
                    rawInput: part.state.input,
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
          if (part.text) {
            await this.connection
              .sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: message.info.role === "user" ? "user_message_chunk" : "agent_message_chunk",
                  content: {
                    type: "text",
                    text: part.text,
                  },
                },
              })
              .catch((err) => {
                log.error("failed to send text to ACP", { error: err })
              })
          }
        } else if (part.type === "reasoning") {
          if (part.text) {
            await this.connection
              .sessionUpdate({
                sessionId,
                update: {
                  sessionUpdate: "agent_thought_chunk",
                  content: {
                    type: "text",
                    text: part.text,
                  },
                },
              })
              .catch((err) => {
                log.error("failed to send reasoning to ACP", { error: err })
              })
          }
        }
      }
    }

    private async loadSessionMode(params: LoadSessionRequest) {
      const directory = params.cwd
      const model = await defaultModel(this.config, directory)
      const sessionId = params.sessionId

      const providers = await this.sdk.config.providers({ directory }).then((x) => x.data!.providers)
      const entries = providers.sort((a, b) => {
        const nameA = a.name.toLowerCase()
        const nameB = b.name.toLowerCase()
        if (nameA < nameB) return -1
        if (nameA > nameB) return 1
        return 0
      })
      const availableModels = entries.flatMap((provider) => {
        const models = Provider.sort(Object.values(provider.models))
        return models.map((model) => ({
          modelId: `${provider.id}/${model.id}`,
          name: `${provider.name}/${model.name}`,
        }))
      })

      const agents = await this.config.sdk.app
        .agents(
          {
            directory,
          },
          { throwOnError: true },
        )
        .then((resp) => resp.data!)

      const commands = await this.config.sdk.command
        .list(
          {
            directory,
          },
          { throwOnError: true },
        )
        .then((resp) => resp.data!)

      const availableCommands = commands.map((command) => ({
        name: command.name,
        description: command.description ?? "",
      }))
      const names = new Set(availableCommands.map((c) => c.name))
      if (!names.has("compact"))
        availableCommands.push({
          name: "compact",
          description: "compact the session",
        })

      const availableModes = agents
        .filter((agent) => agent.mode !== "subagent" && !agent.hidden)
        .map((agent) => ({
          id: agent.name,
          name: agent.name,
          description: agent.description,
        }))

      const defaultAgentName = await AgentModule.defaultAgent()
      const currentModeId = availableModes.find((m) => m.name === defaultAgentName)?.id ?? availableModes[0].id

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
          await this.sdk.mcp
            .add(
              {
                directory,
                name: key,
                config: mcp,
              },
              { throwOnError: true },
            )
            .catch((error) => {
              log.error("failed to add mcp server", { name: key, error })
            })
        }),
      )

      setTimeout(() => {
        this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands,
          },
        })
      }, 0)

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

      const model = Provider.parseModel(params.modelId)

      this.sessionManager.setModel(session.id, {
        providerID: model.providerID,
        modelID: model.modelID,
      })

      return {
        _meta: {},
      }
    }

    async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse | void> {
      this.sessionManager.get(params.sessionId)
      await this.config.sdk.app
        .agents({}, { throwOnError: true })
        .then((x) => x.data)
        .then((agent) => {
          if (!agent) throw new Error(`Agent not found: ${params.modeId}`)
        })
      this.sessionManager.setMode(params.sessionId, params.modeId)
    }

    async prompt(params: PromptRequest) {
      const sessionID = params.sessionId
      const session = this.sessionManager.get(sessionID)
      const directory = session.cwd

      const current = session.model
      const model = current ?? (await defaultModel(this.config, directory))
      if (!current) {
        this.sessionManager.setModel(session.id, model)
      }
      const agent = session.modeId ?? (await AgentModule.defaultAgent())

      const parts: Array<
        { type: "text"; text: string } | { type: "file"; url: string; filename: string; mime: string }
      > = []
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
                filename: "image",
                mime: part.mimeType,
              })
            } else if (part.uri && part.uri.startsWith("http:")) {
              parts.push({
                type: "file",
                url: part.uri,
                filename: "image",
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
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
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
        await this.sdk.session.prompt({
          sessionID,
          model: {
            providerID: model.providerID,
            modelID: model.modelID,
          },
          parts,
          agent,
          directory,
        })
        return done
      }

      const command = await this.config.sdk.command
        .list({ directory }, { throwOnError: true })
        .then((x) => x.data!.find((c) => c.name === cmd.name))
      if (command) {
        await this.sdk.session.command({
          sessionID,
          command: command.name,
          arguments: cmd.args,
          model: model.providerID + "/" + model.modelID,
          agent,
          directory,
        })
        return done
      }

      switch (cmd.name) {
        case "compact":
          await this.config.sdk.session.summarize(
            {
              sessionID,
              directory,
              providerID: model.providerID,
              modelID: model.modelID,
            },
            { throwOnError: true },
          )
          break
      }

      return done
    }

    async cancel(params: CancelNotification) {
      const session = this.sessionManager.get(params.sessionId)
      await this.config.sdk.session.abort(
        {
          sessionID: params.sessionId,
          directory: session.cwd,
        },
        { throwOnError: true },
      )
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

  async function defaultModel(config: ACPConfig, cwd?: string) {
    const sdk = config.sdk
    const configured = config.defaultModel
    if (configured) return configured

    const directory = cwd ?? process.cwd()

    const specified = await sdk.config
      .get({ directory }, { throwOnError: true })
      .then((resp) => {
        const cfg = resp.data
        if (!cfg || !cfg.model) return undefined
        const parsed = Provider.parseModel(cfg.model)
        return {
          providerID: parsed.providerID,
          modelID: parsed.modelID,
        }
      })
      .catch((error) => {
        log.error("failed to load user config for default model", { error })
        return undefined
      })

    const providers = await sdk.config
      .providers({ directory }, { throwOnError: true })
      .then((x) => x.data?.providers ?? [])
      .catch((error) => {
        log.error("failed to list providers for default model", { error })
        return []
      })

    if (specified && providers.length) {
      const provider = providers.find((p) => p.id === specified.providerID)
      if (provider && provider.models[specified.modelID]) return specified
    }

    if (specified && !providers.length) return specified

    const opencodeProvider = providers.find((p) => p.id === "opencode")
    if (opencodeProvider) {
      if (opencodeProvider.models["big-pickle"]) {
        return { providerID: "opencode", modelID: "big-pickle" }
      }
      const [best] = Provider.sort(Object.values(opencodeProvider.models))
      if (best) {
        return {
          providerID: best.providerID,
          modelID: best.id,
        }
      }
    }

    const models = providers.flatMap((p) => Object.values(p.models))
    const [best] = Provider.sort(models)
    if (best) {
      return {
        providerID: best.providerID,
        modelID: best.id,
      }
    }

    if (specified) return specified

    return { providerID: "opencode", modelID: "big-pickle" }
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

  function getNewContent(fileOriginal: string, unifiedDiff: string): string | undefined {
    const result = applyPatch(fileOriginal, unifiedDiff)
    if (result === false) {
      log.error("Failed to apply unified diff (context mismatch)")
      return undefined
    }
    return result
  }
}

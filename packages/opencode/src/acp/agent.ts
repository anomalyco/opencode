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
import type {
  SessionConfigOption,
  SessionConfigOptionCategory,
  SessionConfigSelectOption,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
} from "@agentclientprotocol/sdk/dist/schema/index.js"
import { Log } from "../util/log"
import { ACPSessionManager } from "./session"
import type { ACPConfig, ACPSessionState } from "./types"
import { Provider } from "../provider/provider"
import { Agent as AgentModule } from "../agent/agent"
import { Installation } from "@/installation"
import { MessageV2 } from "@/session/message-v2"
import { Config } from "@/config/config"
import { Todo } from "@/session/todo"
import { Flag } from "@/flag/flag"
import { z } from "zod"
import { LoadAPIKeyError } from "ai"
import type { OpencodeClient, SessionMessageResponse } from "@opencode-ai/sdk/v2"
import { applyPatch } from "diff"

const DEFAULT_VARIANT_VALUE = "default"

type ModeOption = { id: string; name: string; description?: string }
type ModelOption = { modelId: string; name: string }

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
    private configOptionsSupported = false

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
      this.configOptionsSupported = detectConfigOptionsSupport(params)

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

    private shouldUseConfigOptionsFallback() {
      return !this.configOptionsSupported
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
          configOptions: load.configOptions,
          _meta: load._meta,
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

    private async sendConfigOptionsUpdate(sessionId: string, configOptions: SessionConfigOption[]) {
      const updates = ["config_option_update", "config_options_update"] as const
      await Promise.all(
        updates.map(async (sessionUpdate) => {
          await this.connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate,
                configOptions,
              },
            } as unknown as Parameters<AgentSideConnection["sessionUpdate"]>[0])
            .catch((err) => {
              log.error("failed to send config options update", { error: err, sessionUpdate })
            })
        }),
      )
    }

    private async loadAvailableModes(directory: string): Promise<ModeOption[]> {
      const agents = await this.config.sdk.app
        .agents(
          {
            directory,
          },
          { throwOnError: true },
        )
        .then((resp) => resp.data!)

      return agents
        .filter((agent) => agent.mode !== "subagent" && !agent.hidden)
        .map((agent) => ({
          id: agent.name,
          name: agent.name,
          description: agent.description,
        }))
    }

    private async resolveModeState(
      directory: string,
      sessionId: string,
    ): Promise<{ availableModes: ModeOption[]; currentModeId?: string }> {
      const availableModes = await this.loadAvailableModes(directory)
      let currentModeId = this.sessionManager.get(sessionId).modeId
      if (!currentModeId && availableModes.length) {
        const defaultAgentName = await AgentModule.defaultAgent()
        currentModeId = availableModes.find((mode) => mode.name === defaultAgentName)?.id ?? availableModes[0].id
        this.sessionManager.setMode(sessionId, currentModeId)
      }

      return { availableModes, currentModeId }
    }

    private async loadSessionMode(params: LoadSessionRequest) {
      const directory = params.cwd
      const model = await defaultModel(this.config, directory)
      const sessionId = params.sessionId

      const fallbackEnabled = this.shouldUseConfigOptionsFallback()

      const providers = await this.sdk.config.providers({ directory }).then((x) => x.data!.providers)
      const entries = sortProvidersByName(providers)
      const availableVariants = modelVariantsFromProviders(entries, model)
      const currentVariant = this.sessionManager.getVariant(sessionId)
      if (currentVariant && !availableVariants.includes(currentVariant)) {
        this.sessionManager.setVariant(sessionId, undefined)
      }
      const availableModels = buildAvailableModels(entries, { includeVariants: fallbackEnabled })
      const { availableModes, currentModeId } = await this.resolveModeState(directory, sessionId)
      const baseModelId = `${model.providerID}/${model.modelID}`
      const configOptions = buildConfigOptions({
        availableModes,
        currentModeId,
        availableModels,
        currentModelId: baseModelId,
        availableVariants,
        currentVariant: this.sessionManager.getVariant(sessionId),
      })
      const modeState = currentModeId ? { availableModes, currentModeId } : undefined

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

      setTimeout(() => {
        void this.sendConfigOptionsUpdate(sessionId, configOptions)
      }, 0)

      return {
        sessionId,
        models: {
          currentModelId: formatModelIdWithVariant(model, currentVariant, availableVariants, fallbackEnabled),
          availableModels,
        },
        modes: modeState,
        configOptions: configOptions.length ? configOptions : undefined,
        _meta: buildVariantMeta({
          model,
          variant: this.sessionManager.getVariant(sessionId),
          availableVariants,
        }),
      }
    }

    async unstable_setSessionModel(params: SetSessionModelRequest) {
      const session = this.sessionManager.get(params.sessionId)

      const fallbackEnabled = this.shouldUseConfigOptionsFallback()

      const providers = await this.sdk.config
        .providers({ directory: session.cwd }, { throwOnError: true })
        .then((x) => x.data!.providers)
      const entries = sortProvidersByName(providers)

      const selection = fallbackEnabled
        ? parseModelSelection(params.modelId, entries)
        : { model: Provider.parseModel(params.modelId), variant: undefined }
      const model = selection.model

      this.sessionManager.setModel(session.id, {
        providerID: model.providerID,
        modelID: model.modelID,
      })
      if (fallbackEnabled) {
        this.sessionManager.setVariant(session.id, selection.variant)
      }
      const availableVariants = modelVariantsFromProviders(entries, model)
      const currentVariant = this.sessionManager.getVariant(session.id)
      if (currentVariant && !availableVariants.includes(currentVariant)) {
        this.sessionManager.setVariant(session.id, undefined)
      }

      const availableModels = buildAvailableModels(entries, { includeVariants: fallbackEnabled })
      const { availableModes, currentModeId } = await this.resolveModeState(session.cwd, session.id)
      const baseModelId = `${model.providerID}/${model.modelID}`
      const configOptions = buildConfigOptions({
        availableModes,
        currentModeId,
        availableModels,
        currentModelId: baseModelId,
        availableVariants,
        currentVariant: this.sessionManager.getVariant(session.id),
      })
      await this.sendConfigOptionsUpdate(session.id, configOptions)

      return {
        _meta: buildVariantMeta({
          model,
          variant: this.sessionManager.getVariant(session.id),
          availableVariants,
        }),
      }
    }

    async unstable_setSessionConfigOption(
      params: SetSessionConfigOptionRequest,
    ): Promise<SetSessionConfigOptionResponse> {
      const session = this.sessionManager.get(params.sessionId)
      const directory = session.cwd
      const fallbackEnabled = this.shouldUseConfigOptionsFallback()
      let model = session.model ?? (await defaultModel(this.config, directory))
      if (!session.model) {
        this.sessionManager.setModel(session.id, model)
      }

      const providers = await this.sdk.config
        .providers({ directory }, { throwOnError: true })
        .then((x) => x.data!.providers)
      const entries = sortProvidersByName(providers)
      const availableModels = buildAvailableModels(entries, { includeVariants: fallbackEnabled })
      const { availableModes, currentModeId } = await this.resolveModeState(directory, session.id)

      let availableVariants = modelVariantsFromProviders(entries, model)
      if (params.configId === "variant" && availableVariants.length === 0) {
        throw RequestError.invalidParams({ configId: params.configId }, "No variants available")
      }

      switch (params.configId) {
        case "variant": {
          let nextVariant: string | undefined
          if (params.value === DEFAULT_VARIANT_VALUE) {
            nextVariant = undefined
          } else if (availableVariants.includes(params.value)) {
            nextVariant = params.value
          } else {
            throw RequestError.invalidParams({ value: params.value }, "Unsupported variant value")
          }

          const previousVariant = this.sessionManager.getVariant(session.id)
          if (previousVariant !== nextVariant) {
            this.sessionManager.setVariant(session.id, nextVariant)
          }
          break
        }
        case "mode": {
          if (!availableModes.some((mode) => mode.id === params.value)) {
            throw RequestError.invalidParams({ value: params.value }, "Unsupported mode value")
          }
          this.sessionManager.setMode(session.id, params.value)
          break
        }
        case "model": {
          if (!availableModels.some((option) => option.modelId === params.value)) {
            throw RequestError.invalidParams({ value: params.value }, "Unsupported model value")
          }
          const selection = fallbackEnabled
            ? parseModelSelection(params.value, entries)
            : { model: Provider.parseModel(params.value), variant: undefined }
          const nextModel = selection.model
          model = { providerID: nextModel.providerID, modelID: nextModel.modelID }
          this.sessionManager.setModel(session.id, model)
          if (fallbackEnabled) {
            this.sessionManager.setVariant(session.id, selection.variant)
          }

          availableVariants = modelVariantsFromProviders(entries, model)
          const currentVariant = this.sessionManager.getVariant(session.id)
          if (currentVariant && !availableVariants.includes(currentVariant)) {
            this.sessionManager.setVariant(session.id, undefined)
          }
          break
        }
        default:
          throw RequestError.invalidParams({ configId: params.configId }, "Unsupported config option")
      }

      const currentMode = this.sessionManager.get(session.id).modeId ?? currentModeId
      const currentModelId = `${model.providerID}/${model.modelID}`
      const configOptions = buildConfigOptions({
        availableModes,
        currentModeId: currentMode,
        availableModels,
        currentModelId,
        availableVariants,
        currentVariant: this.sessionManager.getVariant(session.id),
      })

      await this.sendConfigOptionsUpdate(session.id, configOptions)

      return {
        configOptions,
        _meta: buildVariantMeta({
          model,
          variant: this.sessionManager.getVariant(session.id),
          availableVariants,
        }),
      }
    }

    async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse | void> {
      const session = this.sessionManager.get(params.sessionId)
      const availableModes = await this.loadAvailableModes(session.cwd)
      if (!availableModes.some((mode) => mode.id === params.modeId)) {
        throw new Error(`Agent not found: ${params.modeId}`)
      }
      this.sessionManager.setMode(params.sessionId, params.modeId)

      const fallbackEnabled = this.shouldUseConfigOptionsFallback()
      const model = session.model ?? (await defaultModel(this.config, session.cwd))
      if (!session.model) {
        this.sessionManager.setModel(session.id, model)
      }

      const providers = await this.sdk.config
        .providers({ directory: session.cwd }, { throwOnError: true })
        .then((x) => x.data!.providers)
      const entries = sortProvidersByName(providers)
      const availableVariants = modelVariantsFromProviders(entries, model)
      const availableModels = buildAvailableModels(entries, { includeVariants: fallbackEnabled })
      const configOptions = buildConfigOptions({
        availableModes,
        currentModeId: params.modeId,
        availableModels,
        currentModelId: `${model.providerID}/${model.modelID}`,
        availableVariants,
        currentVariant: this.sessionManager.getVariant(session.id),
      })

      await this.sendConfigOptionsUpdate(session.id, configOptions)
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
      const previousVariant = this.sessionManager.getVariant(sessionID)
      const requestedVariant = (params._meta as { opencode?: { variant?: string } } | null)?.opencode?.variant
      if (typeof requestedVariant === "string") {
        const providers = await this.sdk.config
          .providers({ directory }, { throwOnError: true })
          .then((x) => x.data!.providers)
        const entries = sortProvidersByName(providers)
        const availableVariants = modelVariantsFromProviders(entries, model)
        if (availableVariants.includes(requestedVariant)) {
          this.sessionManager.setVariant(sessionID, requestedVariant)
        } else {
          this.sessionManager.setVariant(sessionID, undefined)
        }
        const nextVariant = this.sessionManager.getVariant(sessionID)
        if (nextVariant !== previousVariant) {
          const availableModels = buildAvailableModels(entries, { includeVariants: this.shouldUseConfigOptionsFallback() })
          const { availableModes, currentModeId } = await this.resolveModeState(directory, sessionID)
          const configOptions = buildConfigOptions({
            availableModes,
            currentModeId,
            availableModels,
            currentModelId: `${model.providerID}/${model.modelID}`,
            availableVariants,
            currentVariant: nextVariant,
          })
          await this.sendConfigOptionsUpdate(sessionID, configOptions)
        }
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
          variant: this.sessionManager.getVariant(sessionID),
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

  function modelVariantsFromProviders(
    providers: Array<{ id: string; models: Record<string, { variants?: Record<string, any> }> }>,
    model: { providerID: string; modelID: string },
  ): string[] {
    const provider = providers.find((entry) => entry.id === model.providerID)
    if (!provider) return []
    const modelInfo = provider.models[model.modelID]
    if (!modelInfo?.variants) return []
    return Object.keys(modelInfo.variants)
  }

  function sortProvidersByName<T extends { name: string }>(providers: T[]): T[] {
    return [...providers].sort((a, b) => {
      const nameA = a.name.toLowerCase()
      const nameB = b.name.toLowerCase()
      if (nameA < nameB) return -1
      if (nameA > nameB) return 1
      return 0
    })
  }

  function buildAvailableModels(
    providers: Array<{ id: string; name: string; models: Record<string, any> }>,
    options: { includeVariants?: boolean } = {},
  ): ModelOption[] {
    const includeVariants = options.includeVariants ?? false
    return providers.flatMap((provider) => {
      const models = Provider.sort(Object.values(provider.models) as any)
      return models.flatMap((model) => {
        const base: ModelOption = {
          modelId: `${provider.id}/${model.id}`,
          name: `${provider.name}/${model.name}`,
        }
        if (!includeVariants || !model.variants) return [base]
        const variants = Object.keys(model.variants).filter((variant) => variant !== DEFAULT_VARIANT_VALUE)
        const variantOptions = variants.map((variant) => ({
          modelId: `${provider.id}/${model.id}/${variant}`,
          name: `${provider.name}/${model.name} (${variant})`,
        }))
        return [base, ...variantOptions]
      })
    })
  }

  function buildConfigOptions(input: {
    availableModes: ModeOption[]
    currentModeId?: string
    availableModels: ModelOption[]
    currentModelId: string
    availableVariants: string[]
    currentVariant?: string
  }): SessionConfigOption[] {
    const configOptions: SessionConfigOption[] = []

    const modeOption = buildModeConfigOption({
      availableModes: input.availableModes,
      currentModeId: input.currentModeId,
    })
    if (modeOption) configOptions.push(modeOption)

    const modelOption = buildModelConfigOption({
      availableModels: input.availableModels,
      currentModelId: input.currentModelId,
    })
    if (modelOption) configOptions.push(modelOption)

    const variantOption = buildVariantConfigOption({
      modelId: input.currentModelId,
      availableVariants: input.availableVariants,
      currentVariant: input.currentVariant,
    })
    if (variantOption) configOptions.push(variantOption)

    return configOptions
  }

  function buildModeConfigOption(input: {
    availableModes: ModeOption[]
    currentModeId?: string
  }): SessionConfigOption | undefined {
    if (!input.availableModes.length || !input.currentModeId) return undefined

    const options: SessionConfigSelectOption[] = input.availableModes.map((mode) => ({
      name: mode.name,
      value: mode.id,
      description: mode.description ?? undefined,
    }))
    const category: SessionConfigOptionCategory = "mode"

    return {
      id: "mode",
      name: "Mode",
      type: "select",
      currentValue: input.currentModeId,
      options,
      category,
    }
  }

  function buildModelConfigOption(input: {
    availableModels: ModelOption[]
    currentModelId: string
  }): SessionConfigOption | undefined {
    if (!input.availableModels.length) return undefined

    const options: SessionConfigSelectOption[] = input.availableModels.map((model) => ({
      name: model.name,
      value: model.modelId,
    }))
    const category: SessionConfigOptionCategory = "model"

    return {
      id: "model",
      name: "Model",
      type: "select",
      currentValue: input.currentModelId,
      options,
      category,
    }
  }

  function buildVariantConfigOptions(input: {
    modelId: string
    availableVariants: string[]
    currentVariant?: string
  }): SessionConfigOption[] {
    const option = buildVariantConfigOption(input)
    return option ? [option] : []
  }

  function buildVariantConfigOption(input: {
    modelId: string
    availableVariants: string[]
    currentVariant?: string
  }): SessionConfigOption | undefined {
    const variants = input.availableVariants.filter((variant) => variant !== DEFAULT_VARIANT_VALUE)
    if (variants.length === 0) return undefined

    const selectedVariant =
      input.currentVariant && variants.includes(input.currentVariant) ? input.currentVariant : undefined
    const options: SessionConfigSelectOption[] = [
      {
        name: "Default",
        value: DEFAULT_VARIANT_VALUE,
      },
      ...variants.map((variant) => ({
        name: variant,
        value: variant,
      })),
    ]
    const category: SessionConfigOptionCategory = "thought_level"

    return {
      id: "variant",
      name: "Thinking Level",
      type: "select",
      currentValue: selectedVariant ?? DEFAULT_VARIANT_VALUE,
      options,
      category,
      _meta: buildVariantConfigMeta({
        modelId: input.modelId,
        currentVariant: selectedVariant,
        availableVariants: variants,
      }),
    }
  }

  function buildVariantConfigMeta(input: {
    modelId: string
    currentVariant?: string
    availableVariants: string[]
  }) {
    return {
      opencode: {
        modelId: input.modelId,
        currentVariant: input.currentVariant ?? null,
        availableVariants: input.availableVariants,
        hasVariants: input.availableVariants.length > 0,
      },
    }
  }

  function buildVariantMeta(input: {
    model: { providerID: string; modelID: string }
    variant?: string
    availableVariants: string[]
  }) {
    return {
      opencode: {
        modelId: `${input.model.providerID}/${input.model.modelID}`,
        variant: input.variant ?? null,
        availableVariants: input.availableVariants,
      },
    }
  }

  function detectConfigOptionsSupport(params: InitializeRequest): boolean {
    const override = Flag.OPENCODE_ACP_CONFIG_OPTIONS_FALLBACK?.toLowerCase()
    if (override) {
      if (["1", "true", "on", "force", "fallback"].includes(override)) return false
      if (["0", "false", "off", "disable", "disabled"].includes(override)) return true
    }
    // Default to fallback unless client explicitly signals config options support.
    return params.clientCapabilities?._meta?.["config_options"] === true
  }

  function formatModelIdWithVariant(
    model: { providerID: string; modelID: string },
    variant: string | undefined,
    availableVariants: string[],
    includeVariant: boolean,
  ) {
    const base = `${model.providerID}/${model.modelID}`
    if (!includeVariant || !variant || !availableVariants.includes(variant)) return base
    return `${base}/${variant}`
  }

  function parseModelSelection(
    modelId: string,
    providers: Array<{ id: string; name: string; models: Record<string, any> }>,
  ) {
    const parsed = Provider.parseModel(modelId)
    const provider = providers.find((entry) => entry.id === parsed.providerID)
    if (!provider) return { model: { providerID: parsed.providerID, modelID: parsed.modelID }, variant: undefined }

    if (provider.models[parsed.modelID]) {
      return { model: { providerID: parsed.providerID, modelID: parsed.modelID }, variant: undefined }
    }

    const segments = parsed.modelID.split("/")
    if (segments.length > 1) {
      const candidateVariant = segments[segments.length - 1]
      const baseModelId = segments.slice(0, -1).join("/")
      if (provider.models[baseModelId]) {
        const baseModel = { providerID: parsed.providerID, modelID: baseModelId }
        const availableVariants = modelVariantsFromProviders(providers, baseModel)
        if (availableVariants.includes(candidateVariant)) {
          return { model: baseModel, variant: candidateVariant }
        }
      }
    }

    return { model: { providerID: parsed.providerID, modelID: parsed.modelID }, variant: undefined }
  }
}

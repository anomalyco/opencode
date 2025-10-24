import type {
  Agent,
  AgentSideConnection,
  AuthenticateRequest,
  AuthenticateResponse,
  CancelNotification,
  InitializeRequest,
  InitializeResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PermissionOption,
  PromptRequest,
  PromptResponse,
  SetSessionModelRequest,
  SetSessionModelResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
} from "@agentclientprotocol/sdk"
import { Log } from "../util/log"
import { ACPSessionManager } from "./session"
import type { ACPConfig } from "./types"
import { Provider } from "../provider/provider"
import { SessionPrompt } from "../session/prompt"
import { Identifier } from "../id/id"
import { Installation } from "@/installation"
import { SessionLock } from "@/session/lock"
import { Bus } from "@/bus"
import { MessageV2 } from "@/session/message-v2"
import { Storage } from "@/storage/storage"
import { Command } from "@/command"
import { Agent as Agents } from "@/agent/agent"
import { Permission } from "@/permission"

const log = Log.create({ service: "acp-agent" })

export class ACPAgent implements Agent {
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
      const acpSession = this.sessionManager.getByOpenCodeSessionId(event.properties.sessionID)
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
              // TODO: toToolKind
              kind: "edit",
              // TODO: make this better
              locations: this.extractLocations(permission.type, permission.metadata),
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
      const acpSession = this.sessionManager.getByOpenCodeSessionId(part.sessionID)
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
                  kind: this.determineToolKind(part.tool),
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
                  locations: this.extractLocations(part.tool, part.state.input),
                  rawInput: part.state.input,
                },
              })
              .catch((err) => {
                log.error("failed to send tool in_progress to ACP", { error: err })
              })
            break
          case "completed":
            await this.connection
              .sessionUpdate({
                sessionId: acpSession.id,
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: part.callID,
                  status: "completed",
                  content: [
                    {
                      type: "content",
                      content: {
                        type: "text",
                        text: part.state.output,
                      },
                    },
                  ],
                  rawOutput: {
                    output: part.state.output,
                    title: part.state.title,
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
                        text: `Error: ${part.state.error}`,
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
        // TODO: Implement sending reasoning to ACP
      }
    })
  }

  private determineToolKind(toolName: string): "read" | "edit" | "other" {
    const readTools = [
      "read",
      "glob",
      "grep",
      "list",
      "webfetch",
      "context7_resolve_library_id",
      "context7_get_library_docs",
    ]
    const editTools = ["edit", "write", "bash"]

    if (readTools.includes(toolName.toLowerCase())) return "read"
    if (editTools.includes(toolName.toLowerCase())) return "edit"
    return "other"
  }

  private extractLocations(toolName: string, input: Record<string, any>): { path: string }[] {
    try {
      switch (toolName.toLowerCase()) {
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
    } catch {
      return []
    }
  }

  async initialize(params: InitializeRequest) {
    log.info("initialize", { protocolVersion: params.protocolVersion })

    return {
      protocolVersion: 1,
      agentCapabilities: {
        // todo: load session
        loadSession: false,
        // TODO: map acp mcp
        // mcpCapabilities: {
        //   http: true,
        //   sse: true,
        // },
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
    const model = await this.defaultModel()
    const session = await this.sessionManager.create(params.cwd, params.mcpServers, model)
    const availableModels = await this.availableModels()

    const availableCommands = (await Command.list()).map((command) => ({
      name: command.name,
      description: command.description ?? "",
    }))

    setTimeout(() => {
      this.connection.sessionUpdate({
        sessionId: session.id,
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

    return {
      sessionId: session.id,
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

  // async loadSession(params: LoadSessionRequest) {
  //   log.info("loadSession", { sessionId: params.sessionId, cwd: params.cwd })

  //   const defaultModel = await this.defaultModel()
  //   const session = await this.sessionManager.load(params.sessionId, params.cwd, params.mcpServers, defaultModel)
  //   const availableModels = await this.availableModels()

  //   return {
  //     models: {
  //       currentModelId: `${session.model.providerID}/${session.model.modelID}`,
  //       availableModels,
  //     },
  //     _meta: {},
  //   }
  // }

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

  private async defaultModel() {
    const configured = this.config.defaultModel
    if (configured) return configured
    return Provider.defaultModel()
  }

  private async availableModels() {
    const providers = await Provider.list()
    const entries = Object.entries(providers).sort((a, b) => {
      const nameA = a[1].info.name.toLowerCase()
      const nameB = b[1].info.name.toLowerCase()
      if (nameA < nameB) return -1
      if (nameA > nameB) return 1
      return 0
    })
    return entries.flatMap(([providerID, provider]) => {
      const models = Provider.sort(Object.values(provider.info.models))
      return models.map((model) => ({
        modelId: `${providerID}/${model.id}`,
        name: `${provider.info.name}/${model.name}`,
      }))
    })
  }

  async prompt(params: PromptRequest) {
    const acpSession = this.sessionManager.get(params.sessionId)
    if (!acpSession) {
      throw new Error(`Session not found: ${params.sessionId}`)
    }

    const current = acpSession.model
    const model = current ?? (await this.defaultModel())
    if (!current) {
      this.sessionManager.setModel(acpSession.id, model)
    }
    const agent = acpSession.modeId ?? "build"

    const parts = params.prompt.map((content) => {
      if (content.type === "text") {
        return {
          type: "text" as const,
          text: content.text,
        }
      }
      if (content.type === "resource") {
        const resource = content.resource
        let text = ""
        if ("text" in resource && typeof resource.text === "string") {
          text = resource.text
        }
        return {
          type: "text" as const,
          text,
        }
      }
      return {
        type: "text" as const,
        text: JSON.stringify(content),
      }
    })

    await SessionPrompt.prompt({
      sessionID: acpSession.openCodeSessionId,
      messageID: Identifier.ascending("message"),
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
      },
      parts,
      agent,
    })

    return {
      stopReason: "end_turn" as const,
      _meta: {},
    }
  }

  async cancel(params: CancelNotification) {
    SessionLock.abort(params.sessionId)
  }
}

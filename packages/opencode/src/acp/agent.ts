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
  PromptRequest,
  PromptResponse,
  SetSessionModelRequest,
  SetSessionModelResponse,
} from "@agentclientprotocol/sdk"
import { Log } from "../util/log"
import { ACPSessionManager } from "./session"
import type { ACPConfig } from "./types"
import { Provider } from "../provider/provider"
import { SessionPrompt } from "../session/prompt"
import { Identifier } from "../id/id"

export class OpenCodeAgent implements Agent {
  private log = Log.create({ service: "acp-agent" })
  private sessionManager = new ACPSessionManager()
  private connection: AgentSideConnection
  private config: ACPConfig

  constructor(connection: AgentSideConnection, config: ACPConfig = {}) {
    this.connection = connection
    this.config = config
  }

  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    this.log.info("initialize", { protocolVersion: params.protocolVersion })

    return {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: false,
      },
      _meta: {
        opencode: {
          version: await import("../installation").then((m) => m.Installation.VERSION),
        },
      },
    }
  }

  async authenticate(params: AuthenticateRequest): Promise<void | AuthenticateResponse> {
    this.log.info("authenticate", { methodId: params.methodId })
    throw new Error("Authentication not yet implemented")
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    this.log.info("newSession", { cwd: params.cwd, mcpServers: params.mcpServers.length })

    const model = await this.defaultModel()
    const session = await this.sessionManager.create(params.cwd, params.mcpServers, model)
    const availableModels = await this.availableModels()

    return {
      sessionId: session.id,
      models: {
        currentModelId: `${model.providerID}/${model.modelID}`,
        availableModels,
      },
      _meta: {},
    }
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    this.log.info("loadSession", { sessionId: params.sessionId, cwd: params.cwd })

    const defaultModel = await this.defaultModel()
    const session = await this.sessionManager.load(params.sessionId, params.cwd, params.mcpServers, defaultModel)
    const availableModels = await this.availableModels()

    return {
      models: {
        currentModelId: `${session.model.providerID}/${session.model.modelID}`,
        availableModels,
      },
      _meta: {},
    }
  }

  async setSessionModel(params: SetSessionModelRequest): Promise<SetSessionModelResponse> {
    this.log.info("setSessionModel", { sessionId: params.sessionId, modelId: params.modelId })

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

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    this.log.info("prompt", {
      sessionId: params.sessionId,
      promptLength: params.prompt.length,
    })

    const acpSession = this.sessionManager.get(params.sessionId)
    if (!acpSession) {
      throw new Error(`Session not found: ${params.sessionId}`)
    }

    const current = acpSession.model
    const model = current ?? (await this.defaultModel())
    if (!current) {
      this.sessionManager.setModel(acpSession.id, model)
    }

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
      acpConnection: {
        connection: this.connection,
        sessionId: params.sessionId,
      },
    })

    this.log.debug("prompt response completed")

    // Streaming notifications are now handled during prompt execution
    // No need to send final text chunk here

    return {
      stopReason: "end_turn",
      _meta: {},
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    this.log.info("cancel", { sessionId: params.sessionId })
  }
}

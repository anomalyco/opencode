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
} from "@zed-industries/agent-client-protocol"
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

    const session = await this.sessionManager.create(params.cwd, params.mcpServers)

    return {
      sessionId: session.id,
      _meta: {},
    }
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    this.log.info("loadSession", { sessionId: params.sessionId, cwd: params.cwd })

    await this.sessionManager.load(params.sessionId, params.cwd, params.mcpServers)

    return {
      _meta: {},
    }
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

    const model = this.config.defaultModel || (await Provider.defaultModel())

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

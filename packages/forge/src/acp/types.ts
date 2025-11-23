import type { McpServer, AuthMethod } from "@agentclientprotocol/sdk"
import type { OpencodeClient } from "@forge/sdk"

export interface ACPSessionState {
  id: string
  cwd: string
  mcpServers: McpServer[]
  createdAt: Date
  model?: {
    providerID: string
    modelID: string
  }
  modeId?: string
}

export interface ACPConfig {
  sdk: OpencodeClient
  defaultModel?: {
    providerID: string
    modelID: string
  }
}

/**
 * Error thrown when an agent requires authentication before allowing operations
 */
export class AuthenticationRequiredError extends Error {
  constructor(
    message: string,
    public readonly authMethods: AuthMethod[],
  ) {
    super(message)
    this.name = "AuthenticationRequiredError"
  }
}

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
 * JSON-RPC error codes used by ACP
 */
export const ACP_ERROR_CODES = {
  /** Authentication required (-32000) */
  AUTH_REQUIRED: -32000,
  /** Internal error (-32603) */
  INTERNAL_ERROR: -32603,
} as const

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

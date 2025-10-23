import type { McpServer } from "@agentclientprotocol/sdk"

export interface ACPSessionState {
  id: string
  cwd: string
  mcpServers: McpServer[]
  openCodeSessionId: string
  createdAt: Date
  model: {
    providerID: string
    modelID: string
  }
}

export interface ACPConfig {
  defaultModel?: {
    providerID: string
    modelID: string
  }
}

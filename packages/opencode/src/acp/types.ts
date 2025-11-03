import type { McpServer } from "@agentclientprotocol/sdk"

export interface ACPSessionState {
  id: string
  cwd: string
  mcpServers: McpServer[]
  createdAt: Date
  model: {
    providerID: string
    modelID: string
  }
  modeId?: string
}

export interface ACPConfig {
  defaultModel?: {
    providerID: string
    modelID: string
  }
}

import type { McpServer } from "@agentclientprotocol/sdk"
import type { ACP } from "./agent"

export interface ACPSessionState {
  id: string
  parentId?: string
  cwd: string
  mcpServers: McpServer[]
  createdAt: Date
  model: {
    providerID: string
    modelID: string
  }
  modeId?: string
  acpAgent?: ACP.Agent
}

export interface ACPConfig {
  defaultModel?: {
    providerID: string
    modelID: string
  }
}

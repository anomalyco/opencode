import type { McpServer } from "@zed-industries/agent-client-protocol"

export interface ACPSessionState {
  id: string
  cwd: string
  mcpServers: McpServer[]
  openCodeSessionId: string
  createdAt: Date
}

export interface ACPConfig {
  defaultModel?: {
    providerID: string
    modelID: string
  }
}

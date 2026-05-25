import type { McpServer } from "@agentclientprotocol/sdk"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { ProviderV2 } from "@opencode-ai/core/provider"

export interface ACPSessionState {
  id: string
  cwd: string
  mcpServers: McpServer[]
  createdAt: Date
  model?: {
    providerID: ProviderV2.ID
    modelID: ProviderV2.ModelID
  }
  variant?: string
  modeId?: string
}

export interface ACPConfig {
  sdk: OpencodeClient
  defaultModel?: {
    providerID: ProviderV2.ID
    modelID: ProviderV2.ModelID
  }
}

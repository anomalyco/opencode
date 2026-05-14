import type { McpServer } from "@agentclientprotocol/sdk"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import type { ProviderID, ModelID } from "../provider/schema"

/** From ACP `session/new` `_meta.systemPrompt`: full string or append-only fragment for `session.prompt.system`. */
export type ACPSystemPromptMeta = string | { append: string }

export interface ACPSessionState {
  id: string
  cwd: string
  mcpServers: McpServer[]
  createdAt: Date
  model?: {
    providerID: ProviderID
    modelID: ModelID
  }
  variant?: string
  modeId?: string
  /** Carried from `newSession` for ACP bridge only; forwarded as SDK `system` on non-command prompts. */
  systemPrompt?: ACPSystemPromptMeta
}

export interface ACPConfig {
  sdk: OpencodeClient
  defaultModel?: {
    providerID: ProviderID
    modelID: ModelID
  }
}

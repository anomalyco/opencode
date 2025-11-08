import type {
  McpServer,
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk"
import type { OpencodeClient } from "@opencode-ai/sdk"

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

export interface ACPTools {
  readTextFile?(params: ReadTextFileRequest): Promise<ReadTextFileResponse>
  writeTextFile?(params: WriteTextFileRequest): Promise<WriteTextFileResponse>
}

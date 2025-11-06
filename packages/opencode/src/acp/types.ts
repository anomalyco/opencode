import type {
  McpServer,
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@agentclientprotocol/sdk"

export interface ACPTools {
  readTextFile?(params: ReadTextFileRequest): Promise<ReadTextFileResponse>
  writeTextFile?(params: WriteTextFileRequest): Promise<WriteTextFileResponse>
}

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
}

export interface ACPConfig {
  defaultModel?: {
    providerID: string
    modelID: string
  }
}

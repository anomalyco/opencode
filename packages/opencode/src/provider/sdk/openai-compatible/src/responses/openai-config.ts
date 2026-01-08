import type { FetchFunction } from "@ai-sdk/provider-utils"

export type OpenAIConfig = {
  provider: string
  url: (options: { modelId: string; path: string }) => string
  headers: () => Record<string, string | undefined>
  fetch?: FetchFunction
  generateId?: () => string
  /**
   * File ID prefixes used to identify file IDs in Responses API.
   * When undefined, all file data is treated as base64 content.
   *
   * Examples:
   * - OpenAI: ['file-'] for IDs like 'file-abc123'
   * - Azure OpenAI: ['assistant-'] for IDs like 'assistant-abc123'
   */
  fileIdPrefixes?: readonly string[]
}

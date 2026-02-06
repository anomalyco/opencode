import type { OpenRouterConfig } from "./config"

type ProviderIOCapabilities = {
  text: boolean
  audio: boolean
  image: boolean
  video: boolean
  pdf: boolean
}

type ProviderInterleaved =
  | boolean
  | {
      field: "reasoning_content" | "reasoning_details"
    }

export type ProviderModel = {
  id: string
  providerID: string
  name: string
  family?: string
  api: {
    id: string
    url: string
    npm: string
    [key: string]: unknown
  }
  status?: string
  headers?: Record<string, unknown>
  options?: Record<string, unknown>
  cost: {
    input: number
    output: number
    cache: {
      read: number
      write: number
    }
    experimentalOver200K?: {
      input: number
      output: number
      cache: {
        read: number
        write: number
      }
    }
  }
  limit: {
    context: number
    output: number
    input?: number
  }
  capabilities: {
    temperature: boolean
    reasoning: boolean
    attachment: boolean
    toolcall: boolean
    input: ProviderIOCapabilities
    output: ProviderIOCapabilities
    interleaved: ProviderInterleaved
  }
  release_date?: string
  variants?: Record<string, unknown>
  [key: string]: unknown
}

export type ProviderInfo = {
  id: string
  models: Record<string, ProviderModel>
  [key: string]: unknown
}

export type ForkProviderConfig = {
  openrouter?: OpenRouterConfig
}

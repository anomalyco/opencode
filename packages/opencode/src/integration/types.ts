import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import type { Bus } from "../bus/index.js"

export interface Integration {
  readonly name: string
  start(client: OpencodeClient, bus?: Bus.Interface): Promise<void>
  stop(): Promise<void>
}

export interface IntegrationConfig {
  enabled: boolean
  [key: string]: unknown
}

export type IntegrationFactory = (config: IntegrationConfig) => Integration

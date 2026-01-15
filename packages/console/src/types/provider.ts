/**
 * Provider Types
 *
 * TypeScript interfaces for AI provider data from OpenCode Server
 */

export interface ProviderModel {
  id: string
  name: string
  family?: string
  release_date?: string
  attachment?: boolean
  reasoning?: boolean
  temperature?: boolean
  tool_call?: boolean
  cost?: {
    input: number
    output: number
    cache_read?: number
    cache_write?: number
  }
  limit?: {
    context: number
    output: number
  }
  status?: 'alpha' | 'beta' | 'deprecated'
  options?: Record<string, any>
}

export interface Provider {
  id: string
  name: string
  api?: string
  env: string[]
  npm?: string
  models: Record<string, ProviderModel>
}

export interface ProvidersResponse {
  all: Provider[]
  default: Record<string, string>
  connected: string[]
}

export interface SelectedModel {
  providerID: string
  modelID: string
}

/**
 * Check if a model is free (no input cost)
 */
export function isModelFree(model: ProviderModel): boolean {
  return model.cost?.input === 0
}

/**
 * Get display name for a model
 */
export function getModelDisplayName(model: ProviderModel): string {
  return model.name || model.id
}

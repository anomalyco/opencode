// AUTO-GENERATED - DO NOT EDIT
// Generated at: 2026-01-28T11:24:31.262Z
// Source: https://models.dev/api.json

export type ModelsDevModel = {
  id: string
  name: string
  family?: string
  release_date?: string
  attachment?: boolean
  reasoning?: boolean
  temperature?: boolean
  tool_call?: boolean
  interleaved?: true | { field: "reasoning_content" | "reasoning_details" }
  cost?: unknown
  limit?: unknown
  modalities?: unknown
  experimental?: boolean
  status?: "alpha" | "beta" | "deprecated"
  options?: Record<string, unknown>
  headers?: Record<string, string>
  provider?: { npm: string }
  variants?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

export type ModelsDevProvider = {
  api?: string
  name: string
  env: string[]
  id: string
  npm?: string
  models: Record<string, ModelsDevModel>
  [key: string]: unknown
}

export type ModelsData = Record<string, ModelsDevProvider>

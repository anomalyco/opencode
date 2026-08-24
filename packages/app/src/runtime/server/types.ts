import type { ProjectListOutput, WorktreeDirectory } from "@opencode-ai/client/promise"

export type Project = Omit<ProjectListOutput[number], "canonical"> & {
  worktree: string
  worktrees: WorktreeDirectory[]
}

export type FileNode = {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
}

export type FileContent = {
  type: "text" | "binary"
  content: string
  diff?: string
  patch?: {
    oldFileName: string
    newFileName: string
    oldHeader?: string
    newHeader?: string
    hunks: Array<{
      oldStart: number
      oldLines: number
      newStart: number
      newLines: number
      lines: string[]
    }>
    index?: string
  }
  encoding?: "base64"
  mimeType?: string
}

export type Path = {
  home: string
  state: string
  config: string
  worktree: string
  directory: string
}

export type VcsInfo = { branch?: string; default_branch?: string }
export type LspStatus = { id: string; name: string; root: string; status: "connected" | "error" }

export type Agent = {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  topP?: number
  temperature?: number
  color?: string
  permission: Array<{ permission: string; pattern: string; action: "allow" | "deny" | "ask" }>
  model?: { modelID: string; providerID: string }
  variant?: string
  prompt?: string
  options: Record<string, unknown>
  steps?: number
}

export type Model = {
  id: string
  providerID: string
  api: {
    id: string
    url: string
    npm: string
  }
  name: string
  family?: string
  capabilities: {
    temperature: boolean
    reasoning: boolean
    attachment: boolean
    toolcall: boolean
    input: {
      text: boolean
      audio: boolean
      image: boolean
      video: boolean
      pdf: boolean
    }
    output: {
      text: boolean
      audio: boolean
      image: boolean
      video: boolean
      pdf: boolean
    }
    interleaved: boolean | { field: "reasoning" | "reasoning_content" | "reasoning_details" }
  }
  cost: {
    input: number
    output: number
    cache: {
      read: number
      write: number
    }
    tiers?: {
      input: number
      output: number
      cache: { read: number; write: number }
      tier: { type: "context"; size: number }
    }[]
    experimentalOver200K?: {
      input: number
      output: number
      cache: { read: number; write: number }
    }
  }
  limit: {
    context: number
    input?: number
    output: number
  }
  status: "alpha" | "beta" | "deprecated" | "active"
  options: Record<string, unknown>
  headers: Record<string, string>
  release_date: string
  variants?: Record<string, Record<string, unknown>>
}

export type Provider = {
  id: string
  name: string
  source: "env" | "config" | "custom" | "api"
  env: string[]
  key?: string
  options: Record<string, unknown>
  models: Record<string, Model>
}

export type ProviderListResponse = {
  all: Map<string, Provider>
  default: Record<string, string>
  connected: string[]
}

export type ProviderAuthResponse = Record<string, unknown>

export type Config = {
  model?: string
  small_model?: string
  default_agent?: string
  username?: string
  share?: "manual" | "auto" | "disabled"
  autoshare?: boolean
  shell?: string
  plugin?: Array<string | [string, Record<string, unknown>]>
  provider?: Record<string, { npm?: string; models?: Record<string, unknown> }>
  mcp?: Record<string, unknown>
  agent?: Record<string, unknown>
  command?: Record<string, unknown>
  instructions?: string[]
  disabled_providers?: string[]
  enabled_providers?: string[]
  permission?: string | Record<string, unknown>
  tools?: Record<string, boolean>
  experimental?: Record<string, unknown>
  [key: string]: unknown
}

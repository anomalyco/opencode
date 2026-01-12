import type { GeminiTokenExchangeResult } from "./oauth"
import type { PluginInput } from "@opencode-ai/plugin"

export interface OAuthAuthDetails {
  type: "oauth"
  refresh: string
  access: string
  expires: number
}

export interface NonOAuthAuthDetails {
  type: string
  [key: string]: unknown
}

export type AuthDetails = OAuthAuthDetails | NonOAuthAuthDetails

export type GetAuth = () => Promise<AuthDetails>

export interface ProviderModel {
  cost?: {
    input: number
    output: number
    cache?: { read: number; write: number }
  }
  [key: string]: unknown
}

export interface ProviderInfo {
  models?: Record<string, ProviderModel>
  options?: Record<string, unknown>
}

export interface LoaderResult {
  apiKey: string
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>
}

export interface AuthMethod {
  provider?: string
  label: string
  type: "oauth" | "api"
  authorize?: () => Promise<{
    url: string
    instructions: string
    method: string
    callback:
      | (() => Promise<GeminiTokenExchangeResult>)
      | ((callbackUrl: string) => Promise<GeminiTokenExchangeResult>)
  }>
}

export type PluginClient = PluginInput["client"]

export interface PluginContext {
  client: PluginClient
}

export interface PluginResult {
  auth: {
    provider: string
    loader: (getAuth: GetAuth, provider: ProviderInfo) => Promise<LoaderResult | null>
    methods: AuthMethod[]
  }
}

export interface RefreshParts {
  refreshToken: string
  projectId?: string
  managedProjectId?: string
}

export interface ProjectContextResult {
  auth: OAuthAuthDetails
  effectiveProjectId: string
}

// Type for auth that may have optional access/expires (during auth flow)
export interface PartialOAuthAuthDetails {
  type: "oauth"
  refresh: string
  access?: string
  expires?: number
}

export type PartialAuthDetails = PartialOAuthAuthDetails | NonOAuthAuthDetails

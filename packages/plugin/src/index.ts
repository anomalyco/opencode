import type { Project, createOpencodeClient } from "@opencode-ai/sdk"
import type { AuthHook, AuthOAuthResult, AuthOuathResult } from "./auth.js"
import type { Config, PluginOptions } from "./config.js"
import type { Hooks, ProviderContext, ProviderHook, ProviderHookContext } from "./hooks.js"
import type { BunShell } from "./shell.js"
import type { WorkspaceAdapter, WorkspaceInfo, WorkspaceTarget } from "./workspace.js"

export * from "./tool.js"
export type { AuthHook, AuthOAuthResult, AuthOuathResult }
export type { Config, PluginOptions }
export type { Hooks, ProviderContext, ProviderHook, ProviderHookContext }
export type { WorkspaceAdapter, WorkspaceInfo, WorkspaceTarget }

export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>
  project: Project
  directory: string
  worktree: string
  experimental_workspace: {
    register(type: string, adapter: WorkspaceAdapter): void
  }
  readonly listenerUrl?: URL
  serverUrl: URL
  $: BunShell
}

export type Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>

export type PluginModule = {
  id?: string
  server: Plugin
  tui?: never
}

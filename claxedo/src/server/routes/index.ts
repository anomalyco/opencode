/**
 * Route constants and re-exports
 */

// OpenCode API roots that should be proxied based on directory
export const directoryProxyRoots = new Set([
  "agent",
  "command",
  "config",
  "event",
  "experimental",
  "file",
  "find",
  "formatter",
  "global",
  "instance",
  "log",
  "lsp",
  "mcp",
  "path",
  "permission",
  "pty",
  "question",
  "session",
  "skill",
  "tui",
  "vcs",
])

/**
 * Additional roots that should be proxied to the local OpenCode server
 * but NOT forwarded to sandbox-agent (gateway handles these in cloud mode).
 */
export const localOnlyProxyRoots = new Set([
  "auth",
  "provider",
])

/**
 * Check if a pathname should be proxied based on directory
 */
export function shouldDirectoryProxy(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean)
  const root = parts[0] || ""
  if (!root) return false
  return directoryProxyRoots.has(root)
}

// Re-exports
export { GlobalRoutes } from "./global.ts"

export { ProjectRoutes } from "./project.ts"
export { ProviderRoutes } from "./provider.ts"
export { SessionRoutes } from "./session.ts"
export { AuthRoutes } from "./auth.ts"
export { BackendRoutes } from "./backend.ts"
export { WorkspaceRoutes, WorkspaceCreateHandler, WorkspaceWakeHandler, WorkspaceResolveHandler } from "./workspace.ts"
export { ExperimentalRoutes } from "./experimental.ts"
export { AgentHookRoutes } from "./agent-hook.ts"
export { SandboxAgentRoutes, killSandboxAgent } from "./sandbox-agent.ts"

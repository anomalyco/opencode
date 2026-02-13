/**
 * Claxedo Cloud Extension Package
 *
 * This package provides cloud functionality for OpenCode via the extension system.
 * It registers providers, routes, and hooks without modifying upstream files.
 */

import { registerExtensions } from "@opencode-ai/app-shared"
import { appExtensions } from "./extensions/app"
import { serverExtensions } from "./extensions/server"
import { persistExtensions } from "./extensions/persist"
import { syncExtensions } from "./extensions/sync"

/**
 * Configuration for initializing Claxedo cloud extensions.
 */
export interface ClaxedoConfig {
  /** Convex deployment URL (e.g., https://xxx.convex.cloud) */
  convexUrl: string
  /** Base URL for auth endpoints (defaults to window.location.origin) */
  authBaseUrl: string
  /** Gateway URL for session proxying (e.g., http://127.0.0.1:3000) */
  gatewayUrl: string
  /** Enable server-scoped persistence (default: true) */
  serverScopedPersist?: boolean
  /** Enable auto-switching to cloud sessions (default: true) */
  cloudAutoSwitch?: boolean

  // ─────────────────────────────────────────────
  // PLUGGABLE FEATURE FLAGS
  // ─────────────────────────────────────────────

  /** Enable Clerk auth + claxedo server (default: false) */
  authEnabled?: boolean
  /** Allow cloud sandbox workspace creation (default: false) */
  sandboxEnabled?: boolean
  /** Show remote access UI for local workspaces (default: false) */
  tunnelEnabled?: boolean
  /** Enable sandbox-agent CLI selector (OpenCode/Claude/Codex/Amp) in prompt toolbar (default: false) */
  sandboxAgentEnabled?: boolean
  /** Direct Daytona API key for no-auth sandbox mode */
  daytonaApiKey?: string
}

/**
 * Initialize Claxedo cloud extensions.
 *
 * Call this before rendering the app to register all cloud functionality.
 * Extensions are conditionally registered based on feature flags:
 * - authEnabled: Clerk auth + claxedo server
 * - sandboxEnabled: Cloud sandbox workspace creation
 * - tunnelEnabled: Remote access UI for local workspaces
 *
 * @example
 * ```tsx
 * await initClaxedo({
 *   convexUrl: import.meta.env.VITE_CONVEX_URL,
 *   authBaseUrl: window.location.origin,
 *   gatewayUrl: "http://127.0.0.1:3000",
 *   authEnabled: true,
 *   sandboxEnabled: true,
 * })
 *
 * render(() => <App />, document.getElementById("root")!)
 * ```
 */
export function initClaxedo(config: ClaxedoConfig): void {
  const app = appExtensions(config)

  registerExtensions("claxedo", {
    app,
    server: serverExtensions(config),
    persist: persistExtensions(config),
    sync: syncExtensions(config),
  })

  // Only initialize auth if authEnabled (fire-and-forget)
  if (config.authEnabled) {
    app.onInit?.()?.catch((err: unknown) => console.warn("[claxedo] Auth init failed:", err))
  }
}

/**
 * Get the default Claxedo configuration from environment variables.
 */
export function getDefaultConfig(): ClaxedoConfig {
  return {
    convexUrl: import.meta.env.VITE_CONVEX_URL ?? "",
    authBaseUrl:
      (import.meta.env.VITE_AUTH_BASE_URL as string | undefined) ?? window.location.origin,
    gatewayUrl:
      (import.meta.env.VITE_OPENCODE_BACKEND_URL as string | undefined) ??
      "http://127.0.0.1:3000",
    serverScopedPersist: import.meta.env.VITE_SERVER_SCOPED_PERSIST !== "false",
    cloudAutoSwitch: import.meta.env.VITE_CLOUD_AUTOSWITCH !== "false",

    // Feature flags - all default to false for standalone mode
    authEnabled: import.meta.env.VITE_AUTH_ENABLED === "true",
    sandboxEnabled: import.meta.env.VITE_SANDBOX_ENABLED === "true",
    tunnelEnabled: import.meta.env.VITE_TUNNEL_ENABLED === "true",
    sandboxAgentEnabled: import.meta.env.VITE_USE_SANDBOX_AGENT_SERVER === "true",
    daytonaApiKey: import.meta.env.VITE_DAYTONA_API_KEY as string | undefined,
  }
}

// Re-export utilities and types for direct use
export { clerk as authClient, useAuth, waitForClerk, initializeClerk, getAuthToken } from "./utils/auth-client"
export type { ClaxedoConfig as Config }

// Re-export extension factories for advanced use cases
export { appExtensions } from "./extensions/app"
export { serverExtensions } from "./extensions/server"
export { persistExtensions } from "./extensions/persist"
export { syncExtensions } from "./extensions/sync"

// Additional component exports (for direct imports)
export {
  RequireAuth,
  type RequireAuthProps,
  CloudAutoSwitch,
  createCloudAutoSwitchProvider,
  type CloudAutoSwitchProps,
  DialogCreateCloudProject,
  AccountSettingsSection,
} from "./components"

// Additional page exports
export { default as LoginPage, type LoginPageProps } from "./pages/login"
export { default as PermissionsPage } from "./pages/permissions"
export { default as ConfigPage } from "./pages/config"

// Additional provider exports
export {
  AuthProvider,
  useAuthContext,
  type AuthContextValue,
} from "./providers"

// Config context exports
export {
  ConfigProvider,
  useConfig,
  useConfigOptional,
  type ConfigProviderProps,
} from "./context"

// Backend context exports
export {
  useBackend,
  BackendProvider,
  createBackendProvider,
  AGENT_OPTIONS,
  type AgentKind,
} from "./context/backend"

// Re-export overridden contexts (use these instead of @opencode-ai/app versions)
export {
  useGlobalSync,
  GlobalSyncProvider,
} from "@/context/global-sync"
export {
  useGlobalSDK,
  GlobalSDKProvider,
} from "@/context/global-sdk"
export { useLayout, LayoutProvider, LayoutContext, getAvatarColors, type LocalProject } from "@/context/layout"
export { useServer, ServerProvider } from "@/context/server"
export { usePlatform, PlatformProvider, type Platform } from "@/context/platform"
export { useTerminal, TerminalProvider, type LocalPTY } from "@/context/terminal"
export { useSettings, SettingsProvider } from "@/context/settings"
export { useCommand, CommandProvider } from "@/context/command"
export { useLanguage, LanguageProvider } from "@/context/language"
export { useSync, SyncProvider } from "@/context/sync"
export { useFile, FileProvider } from "@/context/file"
export { useComments, CommentsProvider } from "@/context/comments"
export { usePrompt, PromptProvider } from "@/context/prompt"
export { Persist, persisted } from "@/utils/persist"

// Re-export components
export { PromptInput } from "@/components/prompt-input"
export { Terminal } from "@/components/terminal"
export { Titlebar } from "@/components/titlebar"
export { DialogSettings } from "@/components/dialog-settings"

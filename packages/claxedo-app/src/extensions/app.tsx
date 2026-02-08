/**
 * App Extensions Factory
 *
 * Provides app-level extensions for cloud functionality including:
 * - Auth providers
 * - Protected route guards
 * - Cloud-specific routes (login, etc.)
 * - Cloud-specific i18n strings
 * - Web project dialog for creating cloud projects
 * - Account settings section with logout
 * - Cloud workspace creation
 */

import { lazy, Show, Suspense, type ParentComponent, type ParentProps } from "solid-js"
import type { AppExtensions } from "@opencode-ai/app-shared"
import type { ClaxedoConfig } from "../index"
import { cloudStrings } from "../i18n/cloud-strings"
import { initializeClerk, useAuth } from "../utils/auth-client"
import { api, getDefaultBaseUrl } from "../utils/api"
import { DialogCreateCloudProject } from "../components/dialog-create-cloud-project"
import { AccountSettingsSection } from "../components/settings-account-section"

import { createCloudAutoSwitchProvider } from "../components/cloud-auto-switch"
import { ClaxedoLayout } from "../claxedo-ui/ClaxedoLayout"
import { ClaxedoDirectoryProvider } from "../claxedo-ui/components/terminal-content-wrapper"
import { BackendSelectorButton } from "../claxedo-ui/components/backend-selector-button"
import { getModelProviderFilter } from "../context/backend"

/**
 * Resolve workspace info from a directory path.
 */
async function resolveWorkspace(
  baseUrl: string,
  directory: string,
): Promise<{ workspaceId: string; projectId?: string } | null> {
  try {
    return await api.get(`${baseUrl}/api/workspace/resolve?directory=${encodeURIComponent(directory)}`)
  } catch {
    return null
  }
}

/**
 * Create a new cloud workspace (sandbox) for an existing project.
 */
async function createCloudWorkspace(baseUrl: string, projectDirectory: string): Promise<string | undefined> {
  // First resolve the current workspace to get project info
  const current = await resolveWorkspace(baseUrl, projectDirectory)
  if (!current) {
    throw new Error("Could not resolve current workspace")
  }

  // Generate a unique workspace name
  const workspaceName = `workspace-${Date.now()}`

  // Create a new workspace in the same project
  const data = await api.post(`${baseUrl}/api/workspace/create`, {
    projectId: current.projectId,
    workspaceName,
  })

  return data.directory as string | undefined
}

// Lazy load the login page for code splitting
const LoginPage = lazy(() => import("../pages/login"))

/**
 * Auth Provider wrapper component.
 * Provides authentication context to the app.
 */
function createAuthProvider(_config: ClaxedoConfig): ParentComponent {
  return (props: ParentProps) => {
    // Auth state is managed by the Clerk singleton.
    // This provider can be extended to add context if needed.
    return <>{props.children}</>
  }
}

/**
 * Cloud Server Provider wrapper component.
 * Provides cloud server context for session management.
 */
function createCloudServerProvider(_config: ClaxedoConfig): ParentComponent {
  return (props: ParentProps) => {
    // Cloud server state management can be added here.
    // For now, the existing ServerProvider handles this.
    return <>{props.children}</>
  }
}

/**
 * Auth Guard component.
 * Protects routes by requiring authentication in cloud mode.
 */
function createRequireAuth(_config: ClaxedoConfig): ParentComponent {
  return (props: ParentProps) => {
    const auth = useAuth()

    // In cloud mode, check authentication
    const isCloudMode = () => true // Always cloud mode when this package is loaded

    // Show loading state while checking auth, or if authenticated
    const isAuthenticated = () => auth.loading() || auth.isSignedIn() || !isCloudMode()

    // Redirect to login if not authenticated (after loading completes)
    if (!auth.loading() && !auth.isSignedIn() && isCloudMode()) {
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login"
        return null
      }
    }

    return (
      <Show
        when={isAuthenticated()}
        fallback={<div class="size-full flex items-center justify-center">Loading...</div>}
      >
        {props.children}
      </Show>
    )
  }
}

/**
 * Loading fallback component
 */
const Loading = () => <div class="size-full" />

/**
 * Create workspace handler with configurable priority:
 * 1. Direct Daytona API (no-auth mode with own key)
 * 2. Via claxedo server (auth mode)
 * 3. Return undefined -> upstream uses local directory
 */
function createWorkspaceHandler(config: ClaxedoConfig) {
  return async (projectDirectory: string): Promise<string | undefined> => {
    // Priority 1: Direct Daytona API (no-auth mode with own key)
    if (config.daytonaApiKey && !config.authEnabled) {
      // TODO: Implement direct Daytona sandbox creation
      // return createDaytonaSandbox(config.daytonaApiKey, projectDirectory)
      console.warn("[claxedo] Direct Daytona sandbox creation not yet implemented")
    }

    // Priority 2: Via claxedo server (auth mode)
    if (config.authEnabled && config.gatewayUrl) {
      const baseUrl = getDefaultBaseUrl()
      return createCloudWorkspace(baseUrl, projectDirectory)
    }

    // Priority 3: Return undefined -> upstream uses local directory
    return undefined
  }
}

/**
 * Create app extensions for Claxedo.
 *
 * Extensions are conditionally registered based on feature flags:
 * - authEnabled: Clerk auth + claxedo server (providers, authGuard, routes, onInit)
 * - sandboxEnabled: Cloud sandbox workspace creation (webProjectDialog, createWorkspace)
 * - tunnelEnabled: Remote access UI for local workspaces (settingsSections)
 *
 * @param config - Claxedo configuration
 * @returns AppExtensions object to register with the extension system
 */
export function appExtensions(config: ClaxedoConfig): AppExtensions {
  const extensions: AppExtensions = {
    /**
     * Cloud-specific i18n strings merged into core dictionaries.
     * Always included for consistent UX.
     */
    strings: cloudStrings,

    /**
     * Custom layout component with Rail + Tab UI.
     * Replaces the default app shell with Claxedo's layout.
     * Always included - this is the core Claxedo UX.
     */
    layoutComponent: ClaxedoLayout,

    /**
     * Directory-level providers (inside SDKProvider).
     * - ClaxedoDirectoryProvider: handles terminal overlay when terminal tab is active
     *
     * Note: TabPortal was removed — GroupContentRenderer now renders session/review/file
     * content directly (no portal needed). TabPortal would intercept children and try to
     * portal them into TabContentArea hosts that no longer exist, causing blank renders.
     */
    directoryProviders: [ClaxedoDirectoryProvider],

    /**
     * CLI selector in prompt toolbar (before agent selector).
     * Only shown when sandbox-agent is enabled (supports switching CLI agents).
     */
    ...(config.sandboxAgentEnabled
      ? {
          promptPrefix: [BackendSelectorButton],
          modelProviderFilter: getModelProviderFilter,
        }
      : {}),

    /**
     * Settings sections - start empty, populated based on flags.
     */
    settingsSections: [],
  }

  // ─────────────────────────────────────────────
  // AUTH FEATURES (Clerk + claxedo server)
  // ─────────────────────────────────────────────
  if (config.authEnabled) {
    extensions.providers = [createAuthProvider(config), createCloudServerProvider(config)]
    extensions.authGuard = createRequireAuth(config)
    extensions.authenticatedProviders = [createCloudAutoSwitchProvider()]
    extensions.routes = [
      {
        path: "/login",
        component: () => (
          <Suspense fallback={<Loading />}>
            <LoginPage />
          </Suspense>
        ),
      },
    ]
    extensions.onInit = async () => {
      try {
        await initializeClerk()
      } catch (error) {
        console.warn("[claxedo] Failed to initialize Clerk:", error)
      }
    }
    extensions.settingsSections = [AccountSettingsSection]
    extensions.hideShareButton = true
    extensions.serverSelectorMode = "status-only"
  } else {
    // No auth mode - show full server selector
    extensions.serverSelectorMode = "full"
  }

  // ─────────────────────────────────────────────
  // SANDBOX FEATURES (cloud workspace creation)
  // ─────────────────────────────────────────────
  if (config.sandboxEnabled) {
    extensions.webProjectDialog = DialogCreateCloudProject
    extensions.createWorkspace = createWorkspaceHandler(config)
  }

  return extensions
}

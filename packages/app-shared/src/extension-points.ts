/**
 * Extension points allow packages to extend OpenCode without modifying core files.
 * Cloud providers (Claxedo) register extensions at runtime.
 */

// NOTE: OpenCode UI is SolidJS (not React). Use Solid component types.
import type { ParentComponent } from "solid-js"
import type { RouteDefinition } from "@solidjs/router"

import type { Component, JSX } from "solid-js"

/** Props for web project dialog component */
export interface WebProjectDialogProps {
  onSelect: (result: string | string[] | null) => void
}

/** Props for settings section components */
export interface SettingsSectionProps {
  /** Translation function */
  t: (key: string) => string
}

/**
 * App-level extensions for UI customization.
 */
export interface AppExtensions {
  /**
   * Wrap the full app interface (Router + all routes).
   * Keep these providers "server-agnostic" (they should not assume ServerProvider exists).
   */
  providers?: ParentComponent[]

  /**
   * Wrap the authenticated layout (runs inside ServerProvider).
   * Good place for CloudAutoSwitch/session restoration that needs `useServer()`.
   */
  authenticatedProviders?: ParentComponent[]

  /** Additional routes to register (e.g. /login) */
  routes?: RouteDefinition[]

  /** Auth guard component (wraps protected UI) */
  authGuard?: ParentComponent

  /** Additive translations (per-locale flat key-value pairs). */
  strings?: Record<string, Record<string, string>>

  /**
   * Optional init hook (e.g. prefetch auth session).
   * If used, call this from the cloud entrypoint BEFORE rendering.
   */
  onInit?: () => Promise<void>

  /**
   * Dialog component for creating projects in web/cloud mode.
   * If not provided, web mode falls back to DialogSelectDirectory.
   */
  webProjectDialog?: Component<WebProjectDialogProps>

  /**
   * Additional settings sections (e.g. account/logout for cloud mode).
   * Each component receives translation function via props.
   */
  settingsSections?: Component<SettingsSectionProps>[]

  /**
   * Hide the share button in session header.
   * Useful for cloud mode where sharing is handled differently.
   */
  hideShareButton?: boolean

  /**
   * Server selector mode on home page.
   * - "full": Show clickable button that opens server selection modal (default)
   * - "status-only": Show only server status indicator (no modal)
   */
  serverSelectorMode?: "full" | "status-only"

  /**
   * Custom workspace creation function for cloud mode.
   * If provided, this is used instead of the git worktree API.
   * @param projectDirectory - The root project directory
   * @returns The new workspace directory path, or undefined if creation failed
   */
  createWorkspace?: (projectDirectory: string) => Promise<string | undefined>

  /**
   * Custom layout component to replace the default app shell.
   * Use this for complete UI overhauls (e.g., Rail + Tab layout).
   * The component receives children which are the route content.
   */
  layoutComponent?: ParentComponent

  /**
   * Providers that wrap content inside DirectoryLayout (after SDKProvider).
   * Use this for workspace-scoped providers that need SDK context.
   * Example: TerminalProvider for workspace-scoped terminals.
   */
  directoryProviders?: ParentComponent[]

  /**
   * Components rendered at the start of the prompt toolbar (before the agent selector).
   * Use this to inject additional selectors or indicators into the prompt input bar.
   */
  promptPrefix?: Component[]

  /**
   * Reactive accessor that hides the model/agent/variant selectors in the prompt toolbar.
   * When this returns true, only the promptPrefix components are shown (e.g. backend selector).
   * Useful when an external agent (Claude Code, Codex, Amp) handles its own model selection.
   */
  hideModelSelector?: () => boolean

  /**
   * Reactive accessor that filters models by provider ID in the model selector.
   * Returns the provider ID to filter by (e.g. "anthropic" for Claude),
   * or undefined to show all models.
   * Used to restrict model selection to compatible providers for CLI agents.
   */
  modelProviderFilter?: () => string | undefined
}

/**
 * Server-level extensions for URL handling and session resolution.
 */
export interface ServerExtensions {
  /** Transform server URL before use (canonicalization/gateway rewrite). */
  transformUrl?: (url: string) => string

  /** Resolve a cloud session ID to a usable base URL (e.g. `/s/:sessionId` gateway). */
  resolveSessionUrl?: (sessionId: string) => Promise<string | null>
}

/**
 * Persistence extensions for server-scoped storage.
 */
export interface PersistExtensions {
  /** Whether server-scoped persistence is enabled (use Persist.server* helpers when true). */
  serverScoped?: boolean
}

/**
 * Sync extensions for server change notifications.
 */
export interface SyncExtensions {
  /** Called when server URL changes (optional hook for cleanup/rebootstrap). */
  onServerChange?: (newUrl: string, oldUrl: string) => void
}

/**
 * Combined extensions interface.
 */
export type Extensions = {
  app: AppExtensions
  server: ServerExtensions
  persist: PersistExtensions
  sync: SyncExtensions
}

/**
 * Extension plugin type for partial registration.
 */
export type ExtensionPlugin = Partial<Extensions>

// Registry: additive (supports multiple plugins) and survives HMR by living on globalThis.
const globalKey = "__OPENCODE_EXTENSION_PLUGINS__"
const registry = ((globalThis as any)[globalKey] ??= {
  plugins: new Map<string, ExtensionPlugin>(),
})

/**
 * Register extensions with the global registry.
 * Use an id so HMR doesn't duplicate providers/routes.
 *
 * @param id - Unique identifier for this extension set (e.g. "claxedo")
 * @param plugin - The extension plugin to register
 */
export function registerExtensions(id: string, plugin: ExtensionPlugin): void {
  registry.plugins.set(id, plugin)
}

/**
 * Unregister extensions from the global registry.
 *
 * @param id - The identifier of the extension set to remove
 */
export function unregisterExtensions(id: string): void {
  registry.plugins.delete(id)
}

/**
 * Get the merged extensions from all registered plugins.
 * Later registered plugins override earlier ones for non-array fields.
 *
 * @returns The merged Extensions object
 */
export function getExtensions(): Extensions {
  const out: Extensions = { app: {}, server: {}, persist: {}, sync: {} }

  for (const plugin of registry.plugins.values() as Iterable<ExtensionPlugin>) {
    // Merge app extensions
    if (plugin.app?.providers) {
      out.app.providers = [...(out.app.providers ?? []), ...plugin.app.providers]
    }
    if (plugin.app?.authenticatedProviders) {
      out.app.authenticatedProviders = [...(out.app.authenticatedProviders ?? []), ...plugin.app.authenticatedProviders]
    }
    if (plugin.app?.routes) {
      out.app.routes = [...(out.app.routes ?? []), ...plugin.app.routes]
    }
    if (plugin.app?.authGuard) {
      out.app.authGuard = plugin.app.authGuard
    }
    if (plugin.app?.strings) {
      const next = out.app.strings ?? {}
      for (const [lang, dict] of Object.entries(plugin.app.strings)) {
        next[lang] = { ...(next[lang] ?? {}), ...dict }
      }
      out.app.strings = next
    }
    if (plugin.app?.onInit) {
      out.app.onInit = plugin.app.onInit
    }
    if (plugin.app?.webProjectDialog) {
      out.app.webProjectDialog = plugin.app.webProjectDialog
    }
    if (plugin.app?.settingsSections) {
      out.app.settingsSections = [...(out.app.settingsSections ?? []), ...plugin.app.settingsSections]
    }
    if (plugin.app?.hideShareButton !== undefined) {
      out.app.hideShareButton = plugin.app.hideShareButton
    }
    if (plugin.app?.serverSelectorMode) {
      out.app.serverSelectorMode = plugin.app.serverSelectorMode
    }
    if (plugin.app?.createWorkspace) {
      out.app.createWorkspace = plugin.app.createWorkspace
    }
    if (plugin.app?.layoutComponent) {
      out.app.layoutComponent = plugin.app.layoutComponent
    }
    if (plugin.app?.directoryProviders) {
      out.app.directoryProviders = [...(out.app.directoryProviders ?? []), ...plugin.app.directoryProviders]
    }
    if (plugin.app?.promptPrefix) {
      out.app.promptPrefix = [...(out.app.promptPrefix ?? []), ...plugin.app.promptPrefix]
    }
    if (plugin.app?.hideModelSelector) {
      out.app.hideModelSelector = plugin.app.hideModelSelector
    }
    if (plugin.app?.modelProviderFilter) {
      out.app.modelProviderFilter = plugin.app.modelProviderFilter
    }

    // Merge server extensions
    if (plugin.server?.transformUrl) {
      out.server.transformUrl = plugin.server.transformUrl
    }
    if (plugin.server?.resolveSessionUrl) {
      out.server.resolveSessionUrl = plugin.server.resolveSessionUrl
    }

    // Merge persist extensions
    if (plugin.persist?.serverScoped !== undefined) {
      out.persist.serverScoped = plugin.persist.serverScoped
    }

    // Merge sync extensions
    if (plugin.sync?.onServerChange) {
      out.sync.onServerChange = plugin.sync.onServerChange
    }
  }

  return out
}

/**
 * Check if any extensions are registered.
 *
 * @returns True if at least one extension plugin is registered
 */
export function hasExtensions(): boolean {
  return registry.plugins.size > 0
}

/**
 * Get the IDs of all registered extension plugins.
 *
 * @returns Array of registered plugin IDs
 */
export function getRegisteredExtensionIds(): string[] {
  return Array.from(registry.plugins.keys())
}

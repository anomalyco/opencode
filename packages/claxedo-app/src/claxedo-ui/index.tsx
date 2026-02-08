/**
 * Claxedo Extension Entry Point
 *
 * This module provides the Claxedo UI extensions to OpenCode.
 * Import from here to use the Rail + Tab architecture.
 *
 * @example
 * ```tsx
 * import { RailLayout, useClaxedoLayout, ClaxedoLayoutProvider } from '@/claxedo'
 *
 * // Use the full rail layout
 * <RailLayout
 *   workspaces={workspaces}
 *   onNewSession={createSession}
 *   renderSession={(sessionId) => <SessionView id={sessionId} />}
 * />
 *
 * // Or use individual components
 * <ClaxedoLayoutProvider>
 *   <RailSidebar workspaces={workspaces} />
 *   <TopTabBar />
 * </ClaxedoLayoutProvider>
 * ```
 */

// Context
export {
  useClaxedoLayout,
  ClaxedoLayoutProvider,
  type TabType,
  type TabItem,
  type RailState,
  type TopTabsState,
  type WorktreeState,
  type GroupState,
  type SplitState,
} from "./context/claxedo-layout"

// Session params context (for split mode)
export { useSessionParams, SessionParamsProvider } from "./context/session-params"

// Directory scope (provider chain without routing)
export { DirectoryScope } from "./components/directory-scope"

// Group content renderer (for split mode panels)
export { GroupContentRenderer } from "./components/group-content-renderer"

// Layout components
export { RailLayout, RailLayoutInner, useClaxedoEnabled, type RailLayoutProps } from "./layouts/rail-layout"
export { RailSidebar, type RailSidebarProps, type WorkspaceItem } from "./layouts/rail-sidebar"
export { TopTabBar, TopTab, type TopTabBarProps } from "./layouts/top-tab-bar"

// Layout component for extension system
export { ClaxedoLayout } from "./ClaxedoLayout"

/**
 * Feature flag check for Claxedo UI mode.
 *
 * Use this to conditionally render Claxedo vs upstream layout:
 *
 * @example
 * ```tsx
 * import { CLAXEDO_ENABLED } from '@/claxedo'
 *
 * function App() {
 *   if (CLAXEDO_ENABLED) {
 *     return <RailLayout {...props} />
 *   }
 *   return <UpstreamLayout {...props} />
 * }
 * ```
 */
export const CLAXEDO_ENABLED = true // Set to false to disable Claxedo UI

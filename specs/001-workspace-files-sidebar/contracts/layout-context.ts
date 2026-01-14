/**
 * Layout Context API Contract
 *
 * Extension to existing layout context for workspace sidebar state management.
 * This is a TypeScript interface contract, not a REST API.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Persisted state for workspace sidebar
 */
export interface WorkspaceSidebarState {
  /** Whether the sidebar is currently visible */
  opened: boolean
  /** Current width in pixels (200-600) */
  width: number
}

/**
 * API exposed by layout context for workspace sidebar control
 */
export interface WorkspaceSidebarAPI {
  /** Reactive getter for opened state */
  opened: () => boolean
  /** Open the sidebar */
  open: () => void
  /** Close the sidebar */
  close: () => void
  /** Toggle sidebar visibility */
  toggle: () => void
  /** Reactive getter for width */
  width: () => number
  /** Set sidebar width (clamped to 200-600) */
  resize: (width: number) => void
}

// =============================================================================
// Layout Store Schema (v7)
// =============================================================================

/**
 * Extended layout store schema with workspace sidebar
 */
export interface LayoutStoreV7 {
  sidebar: {
    opened: boolean
    width: number
  }
  workspaceSidebar: WorkspaceSidebarState  // NEW
  terminal: {
    height: number
  }
  review: {
    diffStyle: "split" | "unified"
  }
  session: {
    width: number
  }
  mobileSidebar: {
    opened: boolean
  }
  mobileWorkspaceSidebar: {  // NEW - for future mobile support
    opened: boolean
  }
}

// =============================================================================
// Migration Contract
// =============================================================================

/**
 * Migration from v6 to v7 schema
 */
export interface LayoutMigrationV6ToV7 {
  from: "layout.v6"
  to: "layout.v7"

  /**
   * Migration function adds workspaceSidebar with defaults
   */
  migrate: (old: Omit<LayoutStoreV7, "workspaceSidebar" | "mobileWorkspaceSidebar">) => LayoutStoreV7
}

// =============================================================================
// Command Registration Contract
// =============================================================================

/**
 * Command to toggle workspace sidebar
 */
export interface WorkspaceSidebarCommand {
  id: "workspaceSidebar.toggle"
  title: "Toggle workspace files"
  category: "View"
  keybind: "mod+shift+e"
  onSelect: () => void
}

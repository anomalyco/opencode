/**
 * WorkspaceSidebar Component Contract
 *
 * Defines the interface for the new workspace sidebar component.
 */

import type { JSX } from "solid-js"

// =============================================================================
// Component Props
// =============================================================================

/**
 * Props for the WorkspaceSidebar component
 */
export interface WorkspaceSidebarProps {
  /**
   * Root path of the workspace to display
   * @example "/Users/dev/my-project"
   */
  workspacePath: string

  /**
   * Current width of the sidebar in pixels
   * Controlled by parent via layout context
   */
  width: number

  /**
   * Callback when user resizes the sidebar
   * @param width - New width in pixels
   */
  onResize?: (width: number) => void

  /**
   * Callback when user selects a file
   * @param filePath - Absolute path of selected file
   */
  onFileSelect?: (filePath: string) => void

  /**
   * Callback when user activates a file (double-click or Enter)
   * @param filePath - Absolute path of activated file
   */
  onFileActivate?: (filePath: string) => void

  /**
   * Additional CSS classes for the container
   */
  class?: string
}

// =============================================================================
// Component Slots / Children
// =============================================================================

/**
 * Header content for the sidebar
 */
export interface WorkspaceSidebarHeaderProps {
  /**
   * Title to display (typically "Files" or workspace name)
   */
  title: string

  /**
   * Callback when close button is clicked
   */
  onClose?: () => void
}

// =============================================================================
// Internal State
// =============================================================================

/**
 * Internal state managed by the component
 */
export interface WorkspaceSidebarState {
  /**
   * Currently selected file path (single selection)
   */
  selectedFile: string | null

  /**
   * Currently focused file path (for keyboard navigation)
   */
  focusedFile: string | null
}

// =============================================================================
// Event Handlers
// =============================================================================

/**
 * Keyboard events supported by the sidebar
 */
export interface WorkspaceSidebarKeyboardEvents {
  /** Move focus down in tree */
  ArrowDown: () => void
  /** Move focus up in tree */
  ArrowUp: () => void
  /** Expand folder or move into folder */
  ArrowRight: () => void
  /** Collapse folder or move to parent */
  ArrowLeft: () => void
  /** Select focused file */
  Enter: () => void
  /** Activate focused file (open it) */
  "Shift+Enter": () => void
  /** Clear selection */
  Escape: () => void
}

// =============================================================================
// Accessibility Contract
// =============================================================================

/**
 * ARIA attributes for accessibility (FR-015, SC-006)
 */
export interface WorkspaceSidebarA11y {
  /** Container role */
  role: "tree"
  /** Accessible name */
  "aria-label": "Workspace files"

  /** Per-item attributes */
  item: {
    role: "treeitem"
    "aria-selected": boolean
    "aria-expanded"?: boolean // Only for directories
    "aria-level": number
  }
}

// =============================================================================
// Component Signature
// =============================================================================

/**
 * WorkspaceSidebar component signature
 */
export type WorkspaceSidebarComponent = (props: WorkspaceSidebarProps) => JSX.Element

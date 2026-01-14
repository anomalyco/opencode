/**
 * File Activity Context Contract
 *
 * This file defines the TypeScript interface contract for the file activity
 * tracking context. It serves as the API specification for components that
 * need to interact with file activity state.
 *
 * Feature: 003-file-activity-highlight
 * Date: 2026-01-14
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Activity type representing how the AI interacted with a file.
 *
 * Precedence (highest to lowest): created > edited > read
 */
export type FileActivityType = "read" | "edited" | "created"

/**
 * State for a single file's activity within the current session.
 */
export interface FileActivityState {
  /** The highest-precedence activity type for this file */
  type: FileActivityType

  /** Unix timestamp (ms) of the most recent activity */
  timestamp: number

  /** Message ID that triggered this activity */
  messageId: string

  /** Optional list of tool call IDs for debugging */
  toolCalls?: string[]
}

/**
 * Store structure for activity tracking.
 */
export interface FileActivityStore {
  /** Current session being tracked (undefined if no session active) */
  sessionId: string | undefined

  /** Map of file paths (relative) to their activity states */
  files: Record<string, FileActivityState>
}

// =============================================================================
// Context API
// =============================================================================

/**
 * File Activity Context API
 *
 * Provides methods for tracking and querying file activity.
 */
export interface FileActivityContext {
  /**
   * Get the activity state for a specific file.
   *
   * @param path - Relative file path from workspace root
   * @returns Activity state if file has been touched, undefined otherwise
   *
   * @example
   * const activity = ctx.get("src/main.ts")
   * if (activity?.type === "edited") {
   *   // Show edited indicator
   * }
   */
  get(path: string): FileActivityState | undefined

  /**
   * Check if a file has any activity.
   *
   * @param path - Relative file path from workspace root
   * @returns true if file has activity, false otherwise
   */
  has(path: string): boolean

  /**
   * Get aggregated activity type for a directory.
   * Returns the highest-precedence activity type of any child file.
   *
   * @param directoryPath - Relative directory path from workspace root
   * @returns Highest-precedence activity type, or undefined if no children have activity
   *
   * @example
   * const dirActivity = ctx.getDirectoryActivity("src/components")
   * if (dirActivity === "edited") {
   *   // Show indicator that some file in this directory was edited
   * }
   */
  getDirectoryActivity(directoryPath: string): FileActivityType | undefined

  /**
   * Get all files with a specific activity type.
   *
   * @param type - Activity type to filter by
   * @returns Array of file paths with the specified activity type
   */
  getByType(type: FileActivityType): string[]

  /**
   * Get all files with any activity.
   *
   * @returns Array of all file paths with activity
   */
  getAllPaths(): string[]

  /**
   * Get the current session ID being tracked.
   *
   * @returns Session ID or undefined if no session active
   */
  getSessionId(): string | undefined

  /**
   * Clear all activity (typically called when session changes).
   * Internal use only - session changes are handled automatically.
   */
  clear(): void
}

// =============================================================================
// Internal Actions (for context implementation)
// =============================================================================

/**
 * Internal actions for updating activity state.
 * These are used by the event listener to update the store.
 */
export interface FileActivityActions {
  /**
   * Record a file read operation.
   *
   * @param path - Relative file path
   * @param messageId - Message ID that triggered the read
   * @param toolCallId - Tool call ID
   */
  recordRead(path: string, messageId: string, toolCallId: string): void

  /**
   * Record a file edit operation.
   *
   * @param path - Relative file path
   * @param messageId - Message ID that triggered the edit
   * @param toolCallId - Tool call ID
   */
  recordEdit(path: string, messageId: string, toolCallId: string): void

  /**
   * Record a file create operation.
   *
   * @param path - Relative file path
   * @param messageId - Message ID that triggered the create
   * @param toolCallId - Tool call ID
   */
  recordCreate(path: string, messageId: string, toolCallId: string): void

  /**
   * Handle session change - clears activity if session ID differs.
   *
   * @param sessionId - New session ID
   */
  handleSessionChange(sessionId: string): void
}

// =============================================================================
// Visual Configuration
// =============================================================================

/**
 * CSS class configuration for activity indicators.
 */
export interface ActivityVisualConfig {
  /** Background class for the file row */
  background: string

  /** Border class for the file row */
  border: string

  /** Text color class for the badge */
  badgeText: string

  /** Background class for the badge */
  badgeBackground: string

  /** Display text for the badge */
  label: string
}

/**
 * Visual configuration for each activity type.
 */
export const ACTIVITY_VISUAL_CONFIG: Record<FileActivityType, ActivityVisualConfig> = {
  read: {
    background: "bg-surface-diff-add-base/50",
    border: "border-l-2 border-icon-success-base/30",
    badgeText: "text-icon-success-base",
    badgeBackground: "bg-icon-success-base/10",
    label: "read",
  },
  edited: {
    background: "bg-surface-critical-base/50",
    border: "border-l-2 border-icon-critical-base/30",
    badgeText: "text-icon-critical-base",
    badgeBackground: "bg-icon-critical-base/10",
    label: "edited",
  },
  created: {
    background: "bg-surface-warning-base/50",
    border: "border-l-2 border-icon-warning-base/30",
    badgeText: "text-icon-warning-base",
    badgeBackground: "bg-icon-warning-base/10",
    label: "created",
  },
}

// =============================================================================
// Tool Mapping
// =============================================================================

/**
 * Mapping of SDK tool names to activity handlers.
 */
export const TOOL_ACTIVITY_MAP: Record<
  string,
  "read" | "edit" | "write" | undefined
> = {
  Read: "read",
  Edit: "edit",
  Write: "write",
  NotebookEdit: "edit",
  // Other tools don't track file activity
  Bash: undefined,
  Glob: undefined,
  Grep: undefined,
  WebFetch: undefined,
  WebSearch: undefined,
  TodoWrite: undefined,
  Task: undefined,
}

/**
 * File Activity Types
 *
 * Type definitions for tracking AI file operations in the workspace sidebar.
 * Feature: 003-file-activity-highlight
 */

// =============================================================================
// T001: FileActivityType and FileActivityState types
// =============================================================================

/**
 * Activity type representing how the AI interacted with a file.
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

// =============================================================================
// T002: FileActivityStore interface
// =============================================================================

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
// T003: ActivityVisualConfig type and ACTIVITY_VISUAL_CONFIG constant
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
 * Colors: read = yellow, edited = green, created = blue
 */
export const ACTIVITY_VISUAL_CONFIG: Record<FileActivityType, ActivityVisualConfig> = {
  read: {
    background: "bg-surface-warning-base/30",
    border: "border-l-2 border-icon-warning-base/50",
    badgeText: "text-icon-warning-base",
    badgeBackground: "bg-icon-warning-base",
    label: "read",
  },
  edited: {
    background: "bg-surface-diff-add-base/30",
    border: "border-l-2 border-icon-success-base/50",
    badgeText: "text-icon-success-base",
    badgeBackground: "bg-icon-success-base",
    label: "edited",
  },
  created: {
    background: "bg-surface-info-base/30",
    border: "border-l-2 border-icon-info-base/50",
    badgeText: "text-icon-info-base",
    badgeBackground: "bg-icon-info-base",
    label: "created",
  },
}

// =============================================================================
// T004: TOOL_ACTIVITY_MAP constant
// =============================================================================

/**
 * Mapping of SDK tool names to activity handlers.
 * NOTE: Tool names from SDK events are lowercase (e.g., "read", "edit", "write")
 */
export const TOOL_ACTIVITY_MAP: Record<string, "read" | "edit" | "write" | undefined> = {
  read: "read",
  edit: "edit",
  write: "write",
  notebookedit: "edit",
  // Other tools don't track file activity
  bash: undefined,
  glob: undefined,
  grep: undefined,
  webfetch: undefined,
  websearch: undefined,
  todowrite: undefined,
  task: undefined,
}

/**
 * Activity type precedence for upgrade logic.
 * Higher number = higher precedence.
 */
export const ACTIVITY_PRECEDENCE: Record<FileActivityType, number> = {
  read: 1,
  edited: 2,
  created: 3,
}

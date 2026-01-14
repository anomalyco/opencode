/**
 * Component Contracts for File Preview Viewer
 *
 * These TypeScript interfaces define the contracts between components.
 * Implementation should adhere to these interfaces.
 */

import type { JSX } from "solid-js"

// ============================================================================
// Types
// ============================================================================

/**
 * Preview types supported by the file preview feature
 */
export type PreviewType = 'text' | 'markdown' | 'html'

/**
 * Error types that can occur during file preview
 */
export type PreviewErrorType =
  | 'not_found'
  | 'permission_denied'
  | 'binary_file'
  | 'encoding_error'
  | 'file_too_large'
  | 'unsupported_type'

/**
 * Preview error state
 */
export interface PreviewError {
  type: PreviewErrorType
  message: string
}

/**
 * File information required for preview
 */
export interface PreviewFile {
  path: string
  name: string
  size?: number
  content?: {
    text: string
    encoding?: string
  }
}

// ============================================================================
// Component Contracts
// ============================================================================

/**
 * Main FilePreview component props
 *
 * Responsible for:
 * - Detecting file type and selecting appropriate renderer
 * - Managing loading states
 * - Displaying errors
 * - Providing expand/collapse functionality
 */
export interface FilePreviewProps {
  /** File to preview, or null when no file selected */
  file: PreviewFile | null
  /** CSS class for container */
  class?: string
  /** Callback when preview is closed */
  onClose?: () => void
  /** Initial expanded state */
  defaultExpanded?: boolean
}

/**
 * TextPreview component props
 *
 * Renders plain text content with:
 * - Monospace font
 * - Preserved whitespace
 * - Line numbers (optional)
 * - Scrolling for long content
 */
export interface TextPreviewProps {
  /** Text content to display */
  content: string
  /** Whether content was truncated due to size limits */
  truncated?: boolean
  /** CSS class for container */
  class?: string
}

/**
 * HtmlPreview component props
 *
 * Renders HTML content in sandboxed iframe:
 * - Scripts disabled
 * - External resources blocked
 * - Inline styles allowed
 */
export interface HtmlPreviewProps {
  /** HTML content to render (will be sanitized) */
  content: string
  /** Base path for resolving relative URLs (images, etc.) */
  basePath?: string
  /** CSS class for container */
  class?: string
}

/**
 * MarkdownPreview uses the existing Markdown component
 * from packages/ui/src/components/markdown.tsx
 *
 * Props from existing component:
 * - text: string
 * - cacheKey?: string
 * - class?: string
 * - classList?: Record<string, boolean>
 */

// ============================================================================
// Utility Function Contracts
// ============================================================================

/**
 * Detect preview type from filename
 * @param filename - File name or path
 * @returns Preview type or null if unsupported
 */
export type GetPreviewType = (filename: string) => PreviewType | null

/**
 * Validate file content for preview
 * @param content - File content string
 * @param fileSize - File size in bytes
 * @returns Validation result with prepared content or error
 */
export interface ContentValidationResult {
  valid: true
  content: string
  truncated: boolean
  showWarning: boolean
} | {
  valid: false
  error: PreviewError
}

export type ValidateContent = (
  content: string,
  fileSize: number
) => ContentValidationResult

/**
 * Check if content appears to be binary
 * @param content - Content to check (first 8KB is sufficient)
 * @returns true if binary detected
 */
export type IsBinaryContent = (content: string) => boolean

// ============================================================================
// Constants
// ============================================================================

/**
 * Supported file extensions by preview type
 */
export const SUPPORTED_EXTENSIONS = {
  text: ['.txt'] as const,
  markdown: ['.md', '.markdown'] as const,
  html: ['.html', '.htm'] as const,
} as const

/**
 * Size limits for file preview
 */
export const SIZE_LIMITS = {
  /** Maximum content size to display in preview (100KB) */
  PREVIEW_MAX: 100 * 1024,
  /** Size threshold for showing warning (1MB) */
  WARNING_THRESHOLD: 1 * 1024 * 1024,
  /** Hard limit - refuse to preview (5MB) */
  HARD_LIMIT: 5 * 1024 * 1024,
} as const

/**
 * Binary detection settings
 */
export const BINARY_DETECTION = {
  /** Number of bytes to check for binary content */
  CHECK_SIZE: 8 * 1024,
} as const

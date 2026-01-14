/**
 * Types and constants for File Preview Viewer
 */

import type { LocalFile } from "@/context/local"

/**
 * Preview types supported by the file preview feature
 */
export type PreviewType = "text" | "markdown" | "html"

/**
 * Error types that can occur during file preview
 */
export type PreviewErrorType =
  | "not_found"
  | "permission_denied"
  | "binary_file"
  | "encoding_error"
  | "file_too_large"
  | "unsupported_type"

/**
 * Preview error state
 */
export interface PreviewError {
  type: PreviewErrorType
  message: string
}

/**
 * Supported file extensions by preview type
 */
export const SUPPORTED_EXTENSIONS = {
  text: [".txt"] as const,
  markdown: [".md", ".markdown"] as const,
  html: [".html", ".htm"] as const,
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

/**
 * Props for FilePreview component
 */
export interface FilePreviewProps {
  /** File to preview, or null when no file selected */
  file: LocalFile | null
  /** CSS class for container */
  class?: string
  /** Callback when preview is closed */
  onClose?: () => void
}

/**
 * Props for TextPreview component
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
 * Props for HtmlPreview component
 */
export interface HtmlPreviewProps {
  /** HTML content to render (will be sanitized) */
  content: string
  /** CSS class for container */
  class?: string
}

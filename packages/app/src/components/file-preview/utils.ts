/**
 * Utility functions for File Preview Viewer
 */

import {
  type PreviewType,
  type PreviewError,
  SUPPORTED_EXTENSIONS,
  SIZE_LIMITS,
  BINARY_DETECTION,
  EXTENSION_TO_LANGUAGE,
} from "./types"

/**
 * Detect preview type from filename
 * @param filename - File name or path
 * @returns Preview type or null if unsupported
 */
export function getPreviewType(filename: string): PreviewType | null {
  const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase()

  // Handle special filenames without extensions
  const basename = filename.split("/").pop()?.toLowerCase() ?? ""
  if (basename === "dockerfile") {
    return "code"
  }

  if ((SUPPORTED_EXTENSIONS.text as readonly string[]).includes(ext)) {
    return "text"
  }
  if ((SUPPORTED_EXTENSIONS.markdown as readonly string[]).includes(ext)) {
    return "markdown"
  }
  if ((SUPPORTED_EXTENSIONS.html as readonly string[]).includes(ext)) {
    return "html"
  }
  if ((SUPPORTED_EXTENSIONS.code as readonly string[]).includes(ext)) {
    return "code"
  }
  if ((SUPPORTED_EXTENSIONS.config as readonly string[]).includes(ext)) {
    return "code" // Config files use code preview with syntax highlighting
  }
  if ((SUPPORTED_EXTENSIONS.json as readonly string[]).includes(ext)) {
    return "json"
  }
  if ((SUPPORTED_EXTENSIONS.xml as readonly string[]).includes(ext)) {
    return "xml"
  }
  if ((SUPPORTED_EXTENSIONS.image as readonly string[]).includes(ext)) {
    return "image"
  }
  if ((SUPPORTED_EXTENSIONS.csv as readonly string[]).includes(ext)) {
    return "csv"
  }
  if ((SUPPORTED_EXTENSIONS.pdf as readonly string[]).includes(ext)) {
    return "pdf"
  }
  if ((SUPPORTED_EXTENSIONS.docx as readonly string[]).includes(ext)) {
    return "docx"
  }
  if ((SUPPORTED_EXTENSIONS.xlsx as readonly string[]).includes(ext)) {
    return "xlsx"
  }

  return null
}

/**
 * Check if content appears to be binary
 * @param content - Content to check (first 8KB is sufficient)
 * @returns true if binary detected
 */
export function isBinaryContent(content: string): boolean {
  // Check first CHECK_SIZE bytes for null characters
  const checkLength = Math.min(content.length, BINARY_DETECTION.CHECK_SIZE)
  for (let i = 0; i < checkLength; i++) {
    if (content.charCodeAt(i) === 0) {
      return true
    }
  }
  return false
}

/**
 * Content validation result
 */
export type ContentValidationResult =
  | {
      valid: true
      content: string
      truncated: boolean
      showWarning: boolean
    }
  | {
      valid: false
      error: PreviewError
    }

/**
 * Validate file content for preview
 * @param content - File content string
 * @param fileSize - File size in bytes (optional, uses content.length if not provided)
 * @returns Validation result with prepared content or error
 */
export function validateContent(
  content: string,
  fileSize?: number
): ContentValidationResult {
  const size = fileSize ?? content.length

  // Check hard limit
  if (size > SIZE_LIMITS.HARD_LIMIT) {
    return {
      valid: false,
      error: {
        type: "file_too_large",
        message: `File is too large to preview (${formatFileSize(size)}). Maximum size is ${formatFileSize(SIZE_LIMITS.HARD_LIMIT)}.`,
      },
    }
  }

  // Check for binary content
  if (isBinaryContent(content)) {
    return {
      valid: false,
      error: {
        type: "binary_file",
        message: "This file appears to contain binary data and cannot be previewed as text.",
      },
    }
  }

  // Determine if we need to truncate
  const truncated = content.length > SIZE_LIMITS.PREVIEW_MAX
  const showWarning = size > SIZE_LIMITS.WARNING_THRESHOLD

  return {
    valid: true,
    content: truncated ? content.slice(0, SIZE_LIMITS.PREVIEW_MAX) : content,
    truncated,
    showWarning,
  }
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Get programming language for syntax highlighting from filename
 * @param filename - File name or path
 * @returns Language identifier for syntax highlighting
 */
export function getLanguageFromFilename(filename: string): string {
  const basename = filename.split("/").pop()?.toLowerCase() ?? ""

  // Handle special filenames
  if (basename === "dockerfile") {
    return "dockerfile"
  }

  const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase()
  return EXTENSION_TO_LANGUAGE[ext] ?? "plaintext"
}

/**
 * Check if file is an SVG based on extension
 * @param filename - File name or path
 * @returns true if file is SVG
 */
export function isSvgFile(filename: string): boolean {
  const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase()
  return ext === ".svg"
}

/**
 * Get MIME type from file extension for images
 * @param filename - File name or path
 * @returns MIME type string
 */
export function getImageMimeType(filename: string): string {
  const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase()
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
  }
  return mimeTypes[ext] ?? "image/png"
}

/**
 * Get CSV delimiter from filename
 * @param filename - File name or path
 * @returns Delimiter character
 */
export function getCsvDelimiter(filename: string): string {
  const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase()
  return ext === ".tsv" ? "\t" : ","
}

/**
 * Check if file is a TSV based on extension
 * @param filename - File name or path
 * @returns true if file is TSV
 */
export function isTsvFile(filename: string): boolean {
  const ext = filename.substring(filename.lastIndexOf(".")).toLowerCase()
  return ext === ".tsv"
}

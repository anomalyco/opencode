/**
 * Types and constants for File Preview Viewer
 */

import type { LocalFile } from "@/context/local"

/**
 * Preview types supported by the file preview feature
 */
export type PreviewType = "text" | "markdown" | "html" | "code" | "image" | "json" | "xml" | "csv" | "pdf" | "docx" | "xlsx"

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
  text: [".txt", ".log", ".env", ".gitignore", ".dockerignore", ".editorconfig"] as const,
  markdown: [".md", ".markdown", ".mdx"] as const,
  html: [".html", ".htm"] as const,
  code: [
    // JavaScript/TypeScript
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
    // Python
    ".py", ".pyw", ".pyi",
    // Rust
    ".rs",
    // Go
    ".go",
    // C/C++
    ".c", ".h", ".cpp", ".hpp", ".cc", ".cxx",
    // Java/Kotlin
    ".java", ".kt", ".kts",
    // Ruby
    ".rb", ".erb",
    // PHP
    ".php",
    // Shell
    ".sh", ".bash", ".zsh", ".fish",
    // CSS/Styles
    ".css", ".scss", ".sass", ".less", ".styl",
    // Swift/Objective-C
    ".swift", ".m", ".mm",
    // Dart
    ".dart",
    // Lua
    ".lua",
    // Perl
    ".pl", ".pm",
    // R
    ".r", ".R",
    // Scala
    ".scala",
    // Elixir/Erlang
    ".ex", ".exs", ".erl",
    // Haskell
    ".hs",
    // Clojure
    ".clj", ".cljs", ".cljc",
    // SQL
    ".sql",
    // GraphQL
    ".graphql", ".gql",
    // Dockerfile
    ".dockerfile",
  ] as const,
  json: [".json", ".jsonc", ".json5"] as const,
  xml: [".xml", ".svg", ".xsl", ".xslt", ".xsd", ".plist"] as const,
  image: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif"] as const,
  // Config files (treated as code with appropriate highlighting)
  config: [".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".properties"] as const,
  // Spreadsheet/data files
  csv: [".csv", ".tsv"] as const,
  // PDF documents
  pdf: [".pdf"] as const,
  // Microsoft Word documents
  docx: [".docx", ".doc"] as const,
  // Microsoft Excel spreadsheets
  xlsx: [".xlsx", ".xls", ".xlsm", ".xlsb"] as const,
} as const

/**
 * Language mapping for syntax highlighting
 */
export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  // JavaScript/TypeScript
  ".js": "javascript",
  ".jsx": "jsx",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  // Python
  ".py": "python",
  ".pyw": "python",
  ".pyi": "python",
  // Rust
  ".rs": "rust",
  // Go
  ".go": "go",
  // C/C++
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  // Java/Kotlin
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  // Ruby
  ".rb": "ruby",
  ".erb": "erb",
  // PHP
  ".php": "php",
  // Shell
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".fish": "bash",
  // CSS/Styles
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".styl": "stylus",
  // Swift/Objective-C
  ".swift": "swift",
  ".m": "objectivec",
  ".mm": "objectivec",
  // Dart
  ".dart": "dart",
  // Lua
  ".lua": "lua",
  // Perl
  ".pl": "perl",
  ".pm": "perl",
  // R
  ".r": "r",
  ".R": "r",
  // Scala
  ".scala": "scala",
  // Elixir/Erlang
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  // Haskell
  ".hs": "haskell",
  // Clojure
  ".clj": "clojure",
  ".cljs": "clojure",
  ".cljc": "clojure",
  // SQL
  ".sql": "sql",
  // GraphQL
  ".graphql": "graphql",
  ".gql": "graphql",
  // Dockerfile
  ".dockerfile": "dockerfile",
  // Config files
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".ini": "ini",
  ".cfg": "ini",
  ".conf": "ini",
  ".properties": "properties",
  // JSON
  ".json": "json",
  ".jsonc": "json",
  ".json5": "json",
  // XML
  ".xml": "xml",
  ".svg": "xml",
  ".xsl": "xml",
  ".xslt": "xml",
  ".xsd": "xml",
  ".plist": "xml",
}

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

/**
 * Props for CodePreview component
 */
export interface CodePreviewProps {
  /** Code content to display */
  content: string
  /** Programming language for syntax highlighting */
  language: string
  /** Whether content was truncated due to size limits */
  truncated?: boolean
  /** CSS class for container */
  class?: string
}

/**
 * Props for ImagePreview component
 */
export interface ImagePreviewProps {
  /** Image source (base64 data URL or path) */
  src: string
  /** Alt text for the image */
  alt?: string
  /** CSS class for container */
  class?: string
}

/**
 * Props for JsonPreview component
 */
export interface JsonPreviewProps {
  /** JSON content to display */
  content: string
  /** Whether content was truncated due to size limits */
  truncated?: boolean
  /** CSS class for container */
  class?: string
}

/**
 * Props for XmlPreview component
 */
export interface XmlPreviewProps {
  /** XML/SVG content to display */
  content: string
  /** Whether this is an SVG file (can be rendered visually) */
  isSvg?: boolean
  /** Whether content was truncated due to size limits */
  truncated?: boolean
  /** CSS class for container */
  class?: string
}

/**
 * Props for CsvPreview component
 */
export interface CsvPreviewProps {
  /** CSV/TSV content to display */
  content: string
  /** Delimiter character (comma for CSV, tab for TSV) */
  delimiter?: string
  /** Whether content was truncated due to size limits */
  truncated?: boolean
  /** CSS class for container */
  class?: string
}

/**
 * Props for PdfPreview component
 */
export interface PdfPreviewProps {
  /** PDF content as base64 */
  content: string
  /** CSS class for container */
  class?: string
}

/**
 * Props for DocxPreview component
 */
export interface DocxPreviewProps {
  /** DOCX content as base64 */
  content: string
  /** CSS class for container */
  class?: string
}

/**
 * Props for XlsxPreview component
 */
export interface XlsxPreviewProps {
  /** XLSX content as base64 */
  content: string
  /** CSS class for container */
  class?: string
}

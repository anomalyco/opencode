/**
 * File Path Detection Utility
 *
 * Detects file paths in text and normalizes them for display.
 * Handles absolute paths, relative paths, and bare filenames.
 */

// Common file extensions to detect bare filenames
const FILE_EXTENSIONS = new Set([
  // Code
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "rb", "go", "rs", "java", "kt", "swift",
  "c", "cpp", "cc", "h", "hpp", "cs",
  "php", "lua", "r", "scala", "clj",
  // Web
  "html", "htm", "css", "scss", "sass", "less",
  "vue", "svelte", "astro",
  // Data/Config
  "json", "yaml", "yml", "toml", "xml", "csv",
  "env", "ini", "conf", "config",
  // Docs
  "md", "mdx", "txt", "rst", "tex",
  // Shell
  "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
  // Other
  "sql", "graphql", "gql", "proto",
  "dockerfile", "makefile", "cmake",
  "lock", "sum", "mod",
])

export interface FilePathMatch {
  /** The original matched text */
  original: string
  /** Start index in the source string */
  start: number
  /** End index in the source string */
  end: number
  /** The display name (just filename) */
  displayName: string
  /** The path type */
  type: "absolute" | "relative" | "filename"
  /** The normalized path (for lookup) */
  normalizedPath: string
}

/**
 * Detects file paths in a string of text.
 * Returns matches sorted by position (start index).
 */
export function detectFilePaths(text: string): FilePathMatch[] {
  const matches: FilePathMatch[] = []
  const seen = new Set<string>() // Track positions to avoid duplicates

  // Pattern 1: Absolute paths (Unix and Windows)
  // Matches: /path/to/file.ext or C:\path\to\file.ext
  const absolutePattern = /(?:^|[\s"'`(\[{])([A-Za-z]:[\\/](?:[^\s"'`)\]}<>|]+[\\/])*[^\s"'`)\]}<>|]+\.[a-zA-Z0-9]+|\/(?:[^\s"'`)\]}<>|]+\/)*[^\s"'`)\]}<>|]+\.[a-zA-Z0-9]+)/gm

  // Pattern 2: Relative paths (./path or ../path or path/to/file)
  // Must have at least one / and end with an extension
  const relativePattern = /(?:^|[\s"'`(\[{])(\.{1,2}\/[^\s"'`)\]}<>|]+\.[a-zA-Z0-9]+|[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_.-]+)+\.[a-zA-Z0-9]+)/gm

  // Pattern 3: Bare filenames with known extensions
  // Must be preceded by whitespace/punctuation and followed by whitespace/punctuation
  const filenamePattern = /(?:^|[\s"'`(\[{])([a-zA-Z0-9_.-]+\.([a-zA-Z0-9]+))(?=[\s"'`)\]},.:;!?]|$)/gm

  // Helper to add a match if valid
  const addMatch = (
    match: RegExpExecArray,
    pathStr: string,
    type: "absolute" | "relative" | "filename"
  ) => {
    // Clean up the path (remove leading whitespace/quotes that might have been captured)
    const cleanPath = pathStr.trim()
    if (!cleanPath) return

    // Calculate actual start position
    const matchText = match[0]
    const pathIndex = matchText.indexOf(cleanPath)
    const start = match.index + pathIndex
    const end = start + cleanPath.length

    // Create position key for deduplication
    const posKey = `${start}:${end}`
    if (seen.has(posKey)) return
    seen.add(posKey)

    // Get filename for display
    const parts = cleanPath.replace(/\\/g, "/").split("/")
    const displayName = parts[parts.length - 1]

    // Normalize path (convert backslashes, remove leading ./)
    let normalizedPath = cleanPath.replace(/\\/g, "/")
    if (normalizedPath.startsWith("./")) {
      normalizedPath = normalizedPath.slice(2)
    }

    matches.push({
      original: cleanPath,
      start,
      end,
      displayName,
      type,
      normalizedPath,
    })
  }

  // Find absolute paths
  let match: RegExpExecArray | null
  while ((match = absolutePattern.exec(text)) !== null) {
    const pathStr = match[1] || match[0].trim()
    if (pathStr.startsWith("/") || /^[A-Za-z]:/.test(pathStr)) {
      addMatch(match, pathStr, "absolute")
    }
  }

  // Find relative paths
  while ((match = relativePattern.exec(text)) !== null) {
    const pathStr = match[1] || match[0].trim()
    addMatch(match, pathStr, "relative")
  }

  // Find bare filenames (only if extension is known)
  while ((match = filenamePattern.exec(text)) !== null) {
    const pathStr = match[1]
    const ext = match[2]?.toLowerCase()
    if (ext && FILE_EXTENSIONS.has(ext)) {
      // Don't match if it looks like it's part of a URL
      const before = text.slice(Math.max(0, match.index - 10), match.index)
      if (before.includes("://") || before.includes("@")) continue

      addMatch(match, pathStr, "filename")
    }
  }

  // Sort by position and return
  return matches.sort((a, b) => a.start - b.start)
}

/**
 * Gets the file icon name based on file extension.
 */
export function getFileIcon(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase()

  switch (ext) {
    // TypeScript/JavaScript
    case "ts":
    case "tsx":
      return "typescript"
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript"

    // Web
    case "html":
    case "htm":
      return "html"
    case "css":
    case "scss":
    case "sass":
    case "less":
      return "css"
    case "vue":
      return "vue"
    case "svelte":
      return "svelte"

    // Data
    case "json":
      return "json"
    case "yaml":
    case "yml":
      return "yaml"
    case "xml":
      return "xml"
    case "md":
    case "mdx":
      return "markdown"

    // Languages
    case "py":
      return "python"
    case "rb":
      return "ruby"
    case "go":
      return "go"
    case "rs":
      return "rust"
    case "java":
      return "java"
    case "swift":
      return "swift"
    case "c":
    case "cpp":
    case "cc":
    case "h":
    case "hpp":
      return "cpp"

    // Shell
    case "sh":
    case "bash":
    case "zsh":
      return "shell"

    default:
      return "file"
  }
}

/**
 * Extracts the filename from a path string.
 */
export function getFileName(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const parts = normalized.split("/")
  return parts[parts.length - 1] || path
}

import { useMarked } from "../context/marked"
import DOMPurify from "dompurify"
import { checksum } from "@opencode-ai/util/encode"
import { ComponentProps, createResource, splitProps } from "solid-js"
import { isServer } from "solid-js/web"

// Common file extensions that indicate a file path (not a URL)
const FILE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt", "swift",
  "c", "cpp", "cc", "h", "hpp", "cs", "php", "lua", "r", "scala", "clj",
  "html", "htm", "css", "scss", "sass", "less", "vue", "svelte", "astro",
  "json", "yaml", "yml", "toml", "xml", "csv", "env", "ini", "conf", "config",
  "md", "mdx", "txt", "rst", "tex", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
  "sql", "graphql", "gql", "proto", "dockerfile", "makefile", "cmake", "lock", "sum", "mod",
])

/**
 * Check if a string looks like a file path (not a URL)
 */
function isFilePath(text: string): boolean {
  // Skip obvious URLs
  if (text.startsWith("http://") || text.startsWith("https://") || text.startsWith("mailto:")) {
    return false
  }

  // Check if it has a file extension we recognize
  const ext = text.split(".").pop()?.toLowerCase()
  if (ext && FILE_EXTENSIONS.has(ext)) {
    return true
  }

  // Check if it looks like a path (starts with / ./ or ../)
  if (text.startsWith("/") || text.startsWith("./") || text.startsWith("../")) {
    return true
  }

  return false
}

/**
 * Get the filename from a path
 */
function getFilename(path: string): string {
  const parts = path.split("/")
  return parts[parts.length - 1] || path
}

/**
 * SVG icon paths for file types (subset for inline use)
 */
const FILE_ICON_SVGS: Record<string, string> = {
  // Default file icon
  default: `<path d="M4 4a2 2 0 0 1 2-2h4.586A2 2 0 0 1 12 2.586L15.414 6A2 2 0 0 1 16 7.414V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4z" fill="currentColor" opacity="0.2"/><path d="M4 4a2 2 0 0 1 2-2h4.586A2 2 0 0 1 12 2.586L15.414 6A2 2 0 0 1 16 7.414V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4z" stroke="currentColor" stroke-width="1.5" fill="none"/>`,
}

/**
 * Post-process HTML to convert file paths in <code> tags to clickable file chips.
 * This runs after markdown parsing to style inline code that looks like file paths.
 */
function convertCodeToFileChips(html: string): string {
  // Match <code>content</code> where content looks like a file path
  // Using a simple regex since we're working with sanitized HTML
  return html.replace(
    /<code>([^<]+)<\/code>/g,
    (match, content: string) => {
      const trimmed = content.trim()
      if (!isFilePath(trimmed)) {
        return match // Not a file path, keep as-is
      }

      const filename = getFilename(trimmed)

      // Create a styled file chip with data attributes for click handling
      // Using yellow/amber styling similar to the Changed/Referenced highlights in sidebar
      // Use button element to prevent any navigation behavior
      return `<button type="button" class="file-chip-link" data-file-path="${trimmed}" title="${trimmed}"><span class="file-chip-icon"><svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">${FILE_ICON_SVGS.default}</svg></span><span class="file-chip-name">${filename}</span></button>`
    }
  )
}

type Entry = {
  hash: string
  html: string
}

const max = 200
const cache = new Map<string, Entry>()

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement)) return
    if (node.target !== "_blank") return

    const rel = node.getAttribute("rel") ?? ""
    const set = new Set(rel.split(/\s+/).filter(Boolean))
    set.add("noopener")
    set.add("noreferrer")
    node.setAttribute("rel", Array.from(set).join(" "))
  })
}

const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
}

function sanitize(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}

function touch(key: string, value: Entry) {
  cache.delete(key)
  cache.set(key, value)

  if (cache.size <= max) return

  const first = cache.keys().next().value
  if (!first) return
  cache.delete(first)
}

export function Markdown(
  props: ComponentProps<"div"> & {
    text: string
    cacheKey?: string
    class?: string
    classList?: Record<string, boolean>
    onFileClick?: (path: string) => void
  },
) {
  const [local, others] = splitProps(props, ["text", "cacheKey", "class", "classList", "onFileClick"])
  const marked = useMarked()

  const [html] = createResource(
    () => local.text,
    async (markdown) => {
      if (isServer) return ""

      const hash = checksum(markdown)
      const key = local.cacheKey ?? hash

      if (key && hash) {
        const cached = cache.get(key)
        if (cached && cached.hash === hash) {
          touch(key, cached)
          return cached.html
        }
      }

      // Parse markdown and sanitize
      const parsed = await marked.parse(markdown)
      const safe = sanitize(parsed)

      // Post-process: convert <code> tags with file paths to clickable chips
      const processed = convertCodeToFileChips(safe)

      if (key && hash) touch(key, { hash, html: processed })
      return processed
    },
    { initialValue: "" },
  )

  // Handle clicks on file links using SolidJS event delegation
  const handleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement

    // Check for file chip link (class="file-chip-link")
    const fileChip = target.closest(".file-chip-link")
    if (fileChip) {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()

      const filePath = fileChip.getAttribute("data-file-path")
      // Access props.onFileClick directly instead of local.onFileClick to avoid closure issues
      const handler = props.onFileClick
      if (filePath) {
        if (handler) {
          handler(filePath)
        } else {
          // Dispatch a custom event that can be caught at the document level
          document.dispatchEvent(new CustomEvent('file-chip-click', { detail: { path: filePath } }))
        }
      }
      return
    }

    const handler = props.onFileClick
    if (!handler) return

    // Check for regular anchor links
    const anchor = target.closest("a")
    if (!anchor) return

    const href = anchor.getAttribute("href")
    if (!href) return

    // Check if this looks like a file path
    if (isFilePath(href)) {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      handler(href)
    }
  }

  return (
    <div
      data-component="markdown"
      classList={{
        ...(local.classList ?? {}),
        [local.class ?? ""]: !!local.class,
      }}
      innerHTML={html.latest}
      onClick={handleClick}
      {...others}
    />
  )
}

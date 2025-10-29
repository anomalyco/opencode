import { createSignal } from "solid-js"
import { client } from "../api/client"

/**
 * File browser store
 * Manages file system navigation and file operations
 */

export interface FileNode {
  name: string
  path: string
  type: "file" | "directory"
  size?: number
  modified?: number
  children?: FileNode[]
}

export interface OpenFile {
  path: string
  content: string
  language?: string
  isDirty: boolean
  originalContent: string
}

// Current directory path
export const [currentPath, setCurrentPath] = createSignal("/")

// Files in current directory
export const [files, setFiles] = createSignal<FileNode[]>([])

// Loading state
export const [isLoadingFiles, setIsLoadingFiles] = createSignal(false)

// Currently open files (tabs)
export const [openFiles, setOpenFiles] = createSignal<OpenFile[]>([])

// Active file index
export const [activeFileIndex, setActiveFileIndex] = createSignal<number | null>(null)

// File search query
export const [searchQuery, setSearchQuery] = createSignal("")

// Search results
export const [searchResults, setSearchResults] = createSignal<string[]>([])

/**
 * Load files for a directory
 */
export async function loadDirectory(path: string) {
  setIsLoadingFiles(true)
  try {
    const data = await client.listFiles(path)
    setFiles(data)
    setCurrentPath(path)
  } catch (error) {
    console.error("Failed to load directory:", error)
  } finally {
    setIsLoadingFiles(false)
  }
}

/**
 * Open a file in the editor
 */
export async function openFile(path: string) {
  // Check if file is already open
  const existingIndex = openFiles().findIndex((f) => f.path === path)
  if (existingIndex !== -1) {
    setActiveFileIndex(existingIndex)
    return
  }

  try {
    const data = await client.readFile(path)

    const newFile: OpenFile = {
      path,
      content: data.content,
      language: data.language || detectLanguage(path),
      isDirty: false,
      originalContent: data.content,
    }

    setOpenFiles((prev) => [...prev, newFile])
    setActiveFileIndex(openFiles().length) // Index of newly added file
  } catch (error) {
    console.error("Failed to open file:", error)
    throw error
  }
}

/**
 * Close a file tab
 */
export function closeFile(index: number) {
  const file = openFiles()[index]

  // Check if file has unsaved changes
  if (file.isDirty) {
    if (!confirm(`"${file.path}" has unsaved changes. Close anyway?`)) {
      return false
    }
  }

  setOpenFiles((prev) => prev.filter((_, i) => i !== index))

  // Adjust active file index
  if (activeFileIndex() === index) {
    // If closing active file, switch to previous or next
    if (openFiles().length > 0) {
      setActiveFileIndex(Math.max(0, index - 1))
    } else {
      setActiveFileIndex(null)
    }
  } else if (activeFileIndex() !== null && activeFileIndex()! > index) {
    // Adjust index if closing a file before active
    setActiveFileIndex(activeFileIndex()! - 1)
  }

  return true
}

/**
 * Update file content (mark as dirty)
 */
export function updateFileContent(index: number, content: string) {
  setOpenFiles((prev) =>
    prev.map((file, i) => {
      if (i === index) {
        return {
          ...file,
          content,
          isDirty: content !== file.originalContent,
        }
      }
      return file
    }),
  )
}

/**
 * Save current file
 */
export async function saveCurrentFile() {
  const index = activeFileIndex()
  if (index === null) return

  const file = openFiles()[index]
  if (!file.isDirty) return

  try {
    await client.writeFile(file.path, file.content)

    // Mark as clean
    setOpenFiles((prev) =>
      prev.map((f, i) => {
        if (i === index) {
          return {
            ...f,
            isDirty: false,
            originalContent: f.content,
          }
        }
        return f
      }),
    )

    return true
  } catch (error) {
    console.error("Failed to save file:", error)
    throw error
  }
}

/**
 * Search for files
 */
export async function searchFiles(query: string) {
  if (!query.trim()) {
    setSearchResults([])
    return
  }

  try {
    const results = await client.searchFiles(query)
    setSearchResults(results)
  } catch (error) {
    console.error("Failed to search files:", error)
  }
}

/**
 * Navigate up one directory
 */
export function navigateUp() {
  const current = currentPath()
  if (current === "/" || current === "") return

  const parentPath = current.split("/").slice(0, -1).join("/") || "/"
  loadDirectory(parentPath)
}

/**
 * Navigate to a specific path
 */
export function navigateTo(path: string) {
  loadDirectory(path)
}

/**
 * Get active file
 */
export function getActiveFile(): OpenFile | null {
  const index = activeFileIndex()
  if (index === null) return null
  return openFiles()[index] || null
}

/**
 * Detect language from file extension
 */
function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase()

  const languageMap: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    json: "json",
    html: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    cpp: "cpp",
    c: "c",
    cs: "csharp",
    php: "php",
    sh: "shell",
    bash: "shell",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sql: "sql",
    xml: "xml",
    txt: "plaintext",
  }

  return languageMap[ext || ""] || "plaintext"
}

/**
 * Initialize file browser (load root directory)
 */
export function initializeFileBrowser() {
  loadDirectory("/")
}

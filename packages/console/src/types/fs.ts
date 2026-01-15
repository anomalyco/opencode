/**
 * File system types that match Rust structs
 */

export interface FileItem {
  name: string
  path: string
  is_dir: boolean
  size?: number
  children?: FileItem[]
}

export interface FileTreeState {
  expandedFolders: Set<string>
  selectedFile?: string
  loadedDirectories: Map<string, FileItem[]>
}

export interface OpenFile {
  path: string
  name: string
  content: string
  isDirty: boolean
  originalContent: string
}
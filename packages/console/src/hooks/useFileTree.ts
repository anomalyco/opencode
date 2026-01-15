import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { FileItem, FileTreeState } from '../types/fs'

interface UseFileTreeOptions {
  rootPath?: string
  onFileSelect?: (filePath: string) => void
}

export function useFileTree({ rootPath, onFileSelect }: UseFileTreeOptions) {
  const [state, setState] = useState<FileTreeState>({
    expandedFolders: new Set<string>(),
    selectedFile: undefined,
    loadedDirectories: new Map<string, FileItem[]>(),
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load directory contents
  const loadDirectory = useCallback(async (path: string) => {
    if (state.loadedDirectories.has(path)) {
      return state.loadedDirectories.get(path)!
    }

    try {
      setIsLoading(true)
      const items = await invoke<FileItem[]>('read_directory', { path })

      setState(prevState => ({
        ...prevState,
        loadedDirectories: new Map(prevState.loadedDirectories).set(path, items),
      }))

      setError(null)
      return items
    } catch (err: any) {
      const errorMessage = err?.toString() || 'Failed to load directory'
      setError(errorMessage)
      console.error('Failed to load directory:', err)
      return []
    } finally {
      setIsLoading(false)
    }
  }, [state.loadedDirectories])

  // Toggle folder expansion
  const toggleFolder = useCallback(async (folderPath: string) => {
    setState(prevState => {
      const newExpandedFolders = new Set(prevState.expandedFolders)

      if (newExpandedFolders.has(folderPath)) {
        // Collapse folder
        newExpandedFolders.delete(folderPath)
      } else {
        // Expand folder
        newExpandedFolders.add(folderPath)
        // Load directory contents if not already loaded
        if (!prevState.loadedDirectories.has(folderPath)) {
          loadDirectory(folderPath)
        }
      }

      return {
        ...prevState,
        expandedFolders: newExpandedFolders,
      }
    })
  }, [loadDirectory])

  // Select a file
  const selectFile = useCallback((filePath: string) => {
    setState(prevState => ({
      ...prevState,
      selectedFile: filePath,
    }))
    onFileSelect?.(filePath)
  }, [onFileSelect])

  // Load root directory when rootPath changes
  useEffect(() => {
    if (rootPath) {
      setState({
        expandedFolders: new Set([rootPath]),
        selectedFile: undefined,
        loadedDirectories: new Map(),
      })
      loadDirectory(rootPath)
    }
  }, [rootPath, loadDirectory])

  // Get items for a specific directory
  const getDirectoryItems = useCallback((path: string): FileItem[] => {
    return state.loadedDirectories.get(path) || []
  }, [state.loadedDirectories])

  // Check if a folder is expanded
  const isFolderExpanded = useCallback((path: string): boolean => {
    return state.expandedFolders.has(path)
  }, [state.expandedFolders])

  // Check if a folder is loaded
  const isFolderLoaded = useCallback((path: string): boolean => {
    return state.loadedDirectories.has(path)
  }, [state.loadedDirectories])

  // Refresh a directory
  const refreshDirectory = useCallback(async (path: string) => {
    setState(prevState => ({
      ...prevState,
      loadedDirectories: new Map([...prevState.loadedDirectories].filter(([key]) => key !== path)),
    }))
    await loadDirectory(path)
  }, [loadDirectory])

  return {
    // State
    selectedFile: state.selectedFile,
    isLoading,
    error,

    // Actions
    toggleFolder,
    selectFile,
    loadDirectory,
    refreshDirectory,

    // Queries
    getDirectoryItems,
    isFolderExpanded,
    isFolderLoaded,

    // Root items (convenience)
    rootItems: rootPath ? getDirectoryItems(rootPath) : [],
  }
}
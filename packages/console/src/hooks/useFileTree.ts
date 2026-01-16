import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { FileItem, FileTreeState } from '../types'

interface UseFileTreeOptions {
  rootPath?: string
  onFileSelect?: (filePath: string) => void
}

export function useFileTree({ rootPath, onFileSelect }: UseFileTreeOptions) {
  const [state, setState] = useState<Omit<FileTreeState, 'loadedDirectories'>>({
    expandedFolders: new Set<string>(),
    selectedFile: undefined,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Use ref to store loaded directories - doesn't trigger re-renders
  const loadedDirectoriesRef = useRef<Map<string, FileItem[]>>(new Map())
  const loadingDirectoriesRef = useRef<Set<string>>(new Set())
  const [, forceUpdate] = useState({})

  // Load directory contents
  const loadDirectory = useCallback(async (path: string) => {
    // Check if already loaded
    if (loadedDirectoriesRef.current.has(path)) {
      return loadedDirectoriesRef.current.get(path)!
    }

    // Check if already loading
    if (loadingDirectoriesRef.current.has(path)) {
      return []
    }

    try {
      loadingDirectoriesRef.current.add(path)
      setIsLoading(true)
      const items = await invoke<FileItem[]>('read_directory', { path })

      // Store in ref instead of state
      loadedDirectoriesRef.current.set(path, items)
      
      setError(null)
      // Force re-render to show the loaded items
      forceUpdate({})
      return items
    } catch (err: any) {
      const errorMessage = err?.toString() || 'Failed to load directory'
      setError(errorMessage)
      console.error('Failed to load directory:', err)
      return []
    } finally {
      loadingDirectoriesRef.current.delete(path)
      setIsLoading(false)
    }
  }, [])

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
        if (!loadedDirectoriesRef.current.has(folderPath)) {
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
      // Clear previous loaded directories
      loadedDirectoriesRef.current.clear()
      loadingDirectoriesRef.current.clear()
      
      setState({
        expandedFolders: new Set([rootPath]),
        selectedFile: undefined,
      })
      
      // Load root directory - no need to add loadDirectory to deps
      loadDirectory(rootPath)
    }
  }, [rootPath])

  // Get items for a specific directory
  const getDirectoryItems = useCallback((path: string): FileItem[] => {
    return loadedDirectoriesRef.current.get(path) || []
  }, [])

  // Check if a folder is expanded
  const isFolderExpanded = useCallback((path: string): boolean => {
    return state.expandedFolders.has(path)
  }, [state.expandedFolders])

  // Check if a folder is loaded
  const isFolderLoaded = useCallback((path: string): boolean => {
    return loadedDirectoriesRef.current.has(path)
  }, [])

  // Refresh a directory
  const refreshDirectory = useCallback(async (path: string) => {
    loadedDirectoriesRef.current.delete(path)
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
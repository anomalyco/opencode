import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { OpenFile } from '../types'

interface UseOpenFilesOptions {
  onFileChange?: (filePath: string, isDirty: boolean) => void
}

export function useOpenFiles({ onFileChange }: UseOpenFilesOptions = {}) {
  const [openFiles, setOpenFiles] = useState<Map<string, OpenFile>>(new Map())
  const [activeFilePath, setActiveFilePath] = useState<string | undefined>()

  // Open a file
  const openFile = useCallback(async (filePath: string) => {
    // Check if file is already open
    if (openFiles.has(filePath)) {
      setActiveFilePath(filePath)
      return openFiles.get(filePath)!
    }

    try {
      // Load file content from disk
      const content = await invoke<string>('read_file_content', { path: filePath })
      const fileName = filePath.split(/[/\\]/).pop() || 'Untitled'

      const newFile: OpenFile = {
        path: filePath,
        name: fileName,
        content,
        isDirty: false,
        originalContent: content,
      }

      setOpenFiles(prev => new Map(prev).set(filePath, newFile))
      setActiveFilePath(filePath)

      return newFile
    } catch (error: any) {
      const errorMessage = error?.toString() || 'Failed to open file'
      console.error('Failed to open file:', error)
      throw new Error(errorMessage)
    }
  }, [openFiles])

  // Close a file
  const closeFile = useCallback(async (filePath: string): Promise<boolean> => {
    const file = openFiles.get(filePath)
    if (!file) return true

    // If file has unsaved changes, we should prompt the user
    // For now, we'll just close it - the UI can handle prompting
    if (file.isDirty) {
      // TODO: Show confirmation dialog
      console.warn('Closing file with unsaved changes:', filePath)
    }

    setOpenFiles(prev => {
      const newMap = new Map(prev)
      newMap.delete(filePath)
      return newMap
    })

    // If this was the active file, switch to another open file
    if (activeFilePath === filePath) {
      const remainingFiles = Array.from(openFiles.keys()).filter(path => path !== filePath)
      setActiveFilePath(remainingFiles[0])
    }

    return true
  }, [openFiles, activeFilePath])

  // Save a file
  const saveFile = useCallback(async (filePath?: string) => {
    const pathToSave = filePath || activeFilePath
    if (!pathToSave) return false

    const file = openFiles.get(pathToSave)
    if (!file) return false

    try {
      await invoke('write_file_content', {
        path: pathToSave,
        content: file.content,
      })

      // Update file state to mark as saved
      setOpenFiles(prev => {
        const newMap = new Map(prev)
        const updatedFile = {
          ...file,
          isDirty: false,
          originalContent: file.content,
        }
        newMap.set(pathToSave, updatedFile)
        return newMap
      })

      onFileChange?.(pathToSave, false)
      return true
    } catch (error: any) {
      const errorMessage = error?.toString() || 'Failed to save file'
      console.error('Failed to save file:', error)
      throw new Error(errorMessage)
    }
  }, [activeFilePath, openFiles, onFileChange])

  // Save all files
  const saveAllFiles = useCallback(async () => {
    const dirtyFiles = Array.from(openFiles.values()).filter(file => file.isDirty)
    const results = await Promise.allSettled(
      dirtyFiles.map(file => saveFile(file.path))
    )

    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length > 0) {
      throw new Error(`Failed to save ${failures.length} files`)
    }

    return true
  }, [openFiles, saveFile])

  // Update file content (marks as dirty)
  const updateFileContent = useCallback((filePath: string, newContent: string) => {
    const file = openFiles.get(filePath)
    if (!file) return

    const isDirty = newContent !== file.originalContent

    setOpenFiles(prev => {
      const newMap = new Map(prev)
      const updatedFile = {
        ...file,
        content: newContent,
        isDirty,
      }
      newMap.set(filePath, updatedFile)
      return newMap
    })

    onFileChange?.(filePath, isDirty)
  }, [openFiles, onFileChange])

  // Get active file
  const activeFile = activeFilePath ? openFiles.get(activeFilePath) : undefined

  // Get all open files as array
  const openFilesArray = Array.from(openFiles.values())

  // Get dirty files count
  const dirtyFilesCount = openFilesArray.filter(file => file.isDirty).length

  // Check if a file is open
  const isFileOpen = useCallback((filePath: string) => {
    return openFiles.has(filePath)
  }, [openFiles])

  // Switch to a different active file
  const setActiveFile = useCallback((filePath: string) => {
    if (openFiles.has(filePath)) {
      setActiveFilePath(filePath)
    }
  }, [openFiles])

  return {
    // State
    openFiles: openFilesArray,
    activeFile,
    activeFilePath,
    dirtyFilesCount,

    // Actions
    openFile,
    closeFile,
    saveFile,
    saveAllFiles,
    updateFileContent,
    setActiveFile,

    // Queries
    isFileOpen,
  }
}
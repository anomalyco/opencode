import { useState, useCallback, useEffect } from 'react'

export interface RecentWorkspace {
  id: string
  name: string
  rootPath: string
  lastOpenedAt: string
}

const STORAGE_KEY = 'af.recentWorkspaces'
const MAX_RECENT = 10

export function useWorkspaceHistory() {
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch {
      // Ignore parse errors
    }
    return []
  })

  // Persist to localStorage whenever recentWorkspaces changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recentWorkspaces))
    } catch {
      // Ignore storage errors
    }
  }, [recentWorkspaces])

  // Add a workspace to recent history
  const addToHistory = useCallback((workspace: { id: string; name: string; rootPath: string }) => {
    setRecentWorkspaces((prev) => {
      // Remove existing entry with same path
      const filtered = prev.filter((w) => w.rootPath !== workspace.rootPath)

      // Add new entry at the beginning
      const newEntry: RecentWorkspace = {
        ...workspace,
        lastOpenedAt: new Date().toISOString(),
      }

      // Keep only MAX_RECENT items
      return [newEntry, ...filtered].slice(0, MAX_RECENT)
    })
  }, [])

  // Remove a workspace from history
  const removeFromHistory = useCallback((rootPath: string) => {
    setRecentWorkspaces((prev) => prev.filter((w) => w.rootPath !== rootPath))
  }, [])

  // Clear all history
  const clearHistory = useCallback(() => {
    setRecentWorkspaces([])
  }, [])

  // Get workspace by path
  const getByPath = useCallback(
    (rootPath: string): RecentWorkspace | undefined => {
      return recentWorkspaces.find((w) => w.rootPath === rootPath)
    },
    [recentWorkspaces]
  )

  return {
    recentWorkspaces,
    addToHistory,
    removeFromHistory,
    clearHistory,
    getByPath,
  }
}

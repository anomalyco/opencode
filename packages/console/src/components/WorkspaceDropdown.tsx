import { useState, useRef, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspaceHistory, type RecentWorkspace } from '../hooks'

interface Workspace {
  id: string
  name: string
  rootPath: string
}

interface WorkspaceDropdownProps {
  currentWorkspace: Workspace | null
  onSelectWorkspace: (workspace: Workspace) => void
}

export default function WorkspaceDropdown({
  currentWorkspace,
  onSelectWorkspace,
}: WorkspaceDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { recentWorkspaces, addToHistory, removeFromHistory } = useWorkspaceHistory()

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setIsCreating(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleOpenWorkspace = async () => {
    try {
      const rootPath = await invoke<string>('open_workspace_dialog')
      if (rootPath) {
        const id = Date.now().toString()
        const name = rootPath.split(/[/\\]/).pop() || 'Workspace'
        const workspace = { id, name, rootPath }
        
        addToHistory(workspace)
        onSelectWorkspace(workspace)
        setIsOpen(false)
      }
    } catch (err) {
      console.error('Failed to open workspace:', err)
    }
  }

  const handleSelectRecent = (recent: RecentWorkspace) => {
    const workspace: Workspace = {
      id: recent.id,
      name: recent.name,
      rootPath: recent.rootPath,
    }
    addToHistory(workspace) // Update lastOpenedAt
    onSelectWorkspace(workspace)
    setIsOpen(false)
  }

  const handleCreateNew = async () => {
    if (!newWorkspaceName.trim()) return

    try {
      // Open folder dialog to select parent directory
      const parentPath = await invoke<string>('open_workspace_dialog')
      if (parentPath) {
        // Create new workspace in selected directory
        const workspacePath = await invoke<string>('create_new_workspace', {
          parentPath,
          name: newWorkspaceName.trim(),
        })

        const id = Date.now().toString()
        const workspace = {
          id,
          name: newWorkspaceName.trim(),
          rootPath: workspacePath,
        }

        addToHistory(workspace)
        onSelectWorkspace(workspace)
        setIsOpen(false)
        setIsCreating(false)
        setNewWorkspaceName('')
      }
    } catch (err) {
      console.error('Failed to create workspace:', err)
    }
  }

  const handleRemoveRecent = (e: React.MouseEvent, rootPath: string) => {
    e.stopPropagation()
    removeFromHistory(rootPath)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors"
      >
        <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
        <span className="text-gray-200 max-w-32 truncate">
          {currentWorkspace?.name || 'No Workspace'}
        </span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
          {/* Recent Workspaces */}
          {recentWorkspaces.length > 0 && (
            <>
              <div className="px-3 py-2 border-b border-gray-700">
                <h3 className="text-xs font-medium text-gray-400 uppercase">Recent Workspaces</h3>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {recentWorkspaces.map((recent) => {
                  const isActive = currentWorkspace?.rootPath === recent.rootPath

                  return (
                    <button
                      key={recent.rootPath}
                      onClick={() => handleSelectRecent(recent)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm transition-colors group ${
                        isActive ? 'bg-blue-600/20 text-blue-300' : 'text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="font-medium truncate">{recent.name}</span>
                        <span className="text-xs text-gray-500 truncate">{recent.rootPath}</span>
                      </div>
                      <button
                        onClick={(e) => handleRemoveRecent(e, recent.rootPath)}
                        className="p-1 opacity-0 group-hover:opacity-100 hover:bg-gray-600 rounded transition-opacity"
                        title="Remove from recent"
                      >
                        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {/* Actions */}
          <div className="border-t border-gray-700">
            {/* Open Workspace */}
            <button
              onClick={handleOpenWorkspace}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-300 hover:bg-gray-700 transition-colors"
            >
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"
                />
              </svg>
              <span>Open Workspace...</span>
            </button>

            {/* New Workspace */}
            {isCreating ? (
              <div className="px-3 py-2.5 border-t border-gray-700">
                <input
                  type="text"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateNew()}
                  placeholder="Workspace name..."
                  className="w-full px-2 py-1.5 bg-gray-900 border border-gray-600 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  autoFocus
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleCreateNew}
                    disabled={!newWorkspaceName.trim()}
                    className="flex-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-xs text-white transition-colors"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => {
                      setIsCreating(false)
                      setNewWorkspaceName('')
                    }}
                    className="flex-1 px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs text-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsCreating(true)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-300 hover:bg-gray-700 transition-colors border-t border-gray-700"
              >
                <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>New Workspace...</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

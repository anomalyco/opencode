import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import ChatPanel from './components/ChatPanel'
import WorkspacePanel from './components/WorkspacePanel'
import ActionsBar from './components/ActionsBar'

interface Workspace {
  id: string
  name: string
  rootPath: string
}

function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)

  const handleOpenWorkspace = async () => {
    try {
      const rootPath = await invoke<string>('open_workspace_dialog')
      if (rootPath) {
        // Generate a simple workspace ID
        const id = Date.now().toString()
        const name = rootPath.split(/[/\\]/).pop() || 'Workspace'

        setWorkspace({ id, name, rootPath })
      }
    } catch (err) {
      console.error('Failed to open workspace:', err)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {/* Header with Actions */}
      <header className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Agent Foundry Build Studio</h1>
          {workspace && (
            <span className="text-sm text-gray-400 px-2 py-1 bg-gray-700 rounded">
              {workspace.name}
            </span>
          )}
        </div>
        <ActionsBar
          onOpenWorkspace={handleOpenWorkspace}
          workspaceId={workspace?.id}
          workspaceName={workspace?.name}
          rootPath={workspace?.rootPath}
        />
      </header>

      {/* Main Content: Two-Column Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Chat Panel (40%) */}
        <div className="w-2/5 border-r border-gray-700">
          <ChatPanel workspaceId={workspace?.id} rootPath={workspace?.rootPath} />
        </div>

        {/* Right: Workspace Panel (60%) */}
        <div className="w-3/5">
          <WorkspacePanel
            workspaceId={workspace?.id}
            rootPath={workspace?.rootPath}
          />
        </div>
      </div>
    </div>
  )
}

export default App

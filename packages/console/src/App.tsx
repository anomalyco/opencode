import { useState, useRef } from 'react'
import {
  ActionsBar,
  ChatPanel,
  ProviderSelector,
  ResizableSplitter,
  WorkspaceDropdown,
  WorkspacePanel,
} from './components'
import { useSplitPane, useWorkspaceHistory, type SelectedModel } from './hooks'

interface Workspace {
  id: string
  name: string
  rootPath: string
}

function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [selectedModel, setSelectedModel] = useState<SelectedModel | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { addToHistory } = useWorkspaceHistory()

  const {
    leftWidth,
    rightWidth,
    isDragging,
    handleMouseDown,
    handleDoubleClick,
  } = useSplitPane(containerRef)

  const handleSelectWorkspace = (ws: Workspace) => {
    setWorkspace(ws)
    addToHistory(ws)
  }

  const handleModelChange = (model: SelectedModel) => {
    setSelectedModel(model)
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {/* Header with Actions */}
      <header className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Agent Foundry Build Studio</h1>
          
          {/* Workspace Dropdown */}
          <WorkspaceDropdown
            currentWorkspace={workspace}
            onSelectWorkspace={handleSelectWorkspace}
          />

          {/* Provider Selector */}
          <ProviderSelector onModelChange={handleModelChange} />
        </div>

        <ActionsBar
          workspaceId={workspace?.id}
          workspaceName={workspace?.name}
          rootPath={workspace?.rootPath}
        />
      </header>

      {/* Main Content: Resizable Two-Column Layout */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* Left: Chat Panel */}
        <div style={{ width: leftWidth }} className="min-w-[280px] overflow-hidden">
          <ChatPanel
            workspaceId={workspace?.id}
            rootPath={workspace?.rootPath}
            selectedModel={selectedModel}
          />
        </div>

        {/* Resizable Splitter */}
        <ResizableSplitter
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
          isDragging={isDragging}
        />

        {/* Right: Workspace Panel */}
        <div style={{ width: rightWidth }} className="min-w-[400px] overflow-hidden">
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

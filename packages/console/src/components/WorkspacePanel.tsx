import { useState } from 'react'
import { CodeTab, PreviewTab } from './'

type TabType = 'preview' | 'code'

interface WorkspacePanelProps {
  workspaceId?: string
  rootPath?: string
}

export default function WorkspacePanel({ workspaceId, rootPath }: WorkspacePanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('preview')

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Tab Header */}
      <div className="flex items-center border-b border-gray-700">
        <button
          onClick={() => setActiveTab('preview')}
          className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'preview'
              ? 'text-white border-blue-500'
              : 'text-gray-400 border-transparent hover:text-gray-300'
          }`}
        >
          Preview
        </button>
        <button
          onClick={() => setActiveTab('code')}
          className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'code'
              ? 'text-white border-blue-500'
              : 'text-gray-400 border-transparent hover:text-gray-300'
          }`}
        >
          Code
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'preview' ? (
          <PreviewTab workspaceId={workspaceId} rootPath={rootPath} />
        ) : (
          <CodeTab workspaceId={workspaceId} rootPath={rootPath} />
        )}
      </div>
    </div>
  )
}

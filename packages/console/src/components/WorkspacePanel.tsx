import { useState } from 'react'
import { CodeTab, PreviewTab } from './'
import type { LintResult } from '../hooks'

type TabType = 'preview' | 'code'

interface WorkspacePanelProps {
  workspaceId?: string
  rootPath?: string
  lintResult?: LintResult | null
  isLintChecking?: boolean
  onFixLintErrors?: () => void
}

export default function WorkspacePanel({ 
  workspaceId, 
  rootPath,
  lintResult,
  isLintChecking,
  onFixLintErrors,
}: WorkspacePanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('preview')

  // Show lint error indicator on Preview tab
  const hasLintErrors = lintResult && !lintResult.success && lintResult.error_count > 0

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Tab Header */}
      <div className="flex items-center border-b border-gray-700">
        <button
          onClick={() => setActiveTab('preview')}
          className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === 'preview'
              ? 'text-white border-blue-500'
              : 'text-gray-400 border-transparent hover:text-gray-300'
          }`}
        >
          Preview
          {hasLintErrors && (
            <span className="flex items-center justify-center w-5 h-5 text-xs bg-red-600 rounded-full">
              {lintResult.error_count}
            </span>
          )}
          {isLintChecking && (
            <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          )}
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
      <div className="flex-1 overflow-hidden relative">
        {/* Preview Tab - always mounted, conditionally visible */}
        <div 
          className="absolute inset-0"
          style={{ display: activeTab === 'preview' ? 'block' : 'none' }}
        >
          <PreviewTab 
            workspaceId={workspaceId} 
            rootPath={rootPath}
            lintResult={lintResult}
            isLintChecking={isLintChecking}
            onFixLintErrors={onFixLintErrors}
          />
        </div>
        
        {/* Code Tab - always mounted, conditionally visible */}
        <div 
          className="absolute inset-0"
          style={{ display: activeTab === 'code' ? 'block' : 'none' }}
        >
          <CodeTab workspaceId={workspaceId} rootPath={rootPath} />
        </div>
      </div>
    </div>
  )
}

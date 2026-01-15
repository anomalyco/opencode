import { useState } from 'react'
import { DeployDialog } from './'

interface ActionsBarProps {
  workspaceId?: string
  workspaceName?: string
  rootPath?: string
}

export default function ActionsBar({
  workspaceId,
  workspaceName,
  rootPath
}: ActionsBarProps) {
  const [isDeployDialogOpen, setIsDeployDialogOpen] = useState(false)

  const handleDeploy = () => {
    if (!workspaceId || !rootPath) {
      alert('Please open a workspace first before deploying')
      return
    }
    setIsDeployDialogOpen(true)
  }

  const handleExport = () => {
    alert('Export to Local - Coming soon!')
  }

  const handleCopy = () => {
    alert('Copy Workspace - Coming soon!')
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={handleDeploy}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
            workspaceId
              ? 'bg-blue-600 hover:bg-blue-700'
              : 'bg-gray-600 cursor-not-allowed opacity-50'
          }`}
          disabled={!workspaceId}
          title={!workspaceId ? 'Open a workspace to deploy' : 'Deploy to Agent Foundry'}
        >
          Deploy to AF
        </button>
        <button
          onClick={handleExport}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
            workspaceId
              ? 'bg-gray-700 hover:bg-gray-600'
              : 'bg-gray-600 cursor-not-allowed opacity-50'
          }`}
          disabled={!workspaceId}
        >
          Export Local
        </button>
        <button
          onClick={handleCopy}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
            workspaceId
              ? 'bg-gray-700 hover:bg-gray-600'
              : 'bg-gray-600 cursor-not-allowed opacity-50'
          }`}
          disabled={!workspaceId}
        >
          Copy
        </button>
      </div>

      {/* Deploy Dialog */}
      {workspaceId && rootPath && (
        <DeployDialog
          isOpen={isDeployDialogOpen}
          onClose={() => setIsDeployDialogOpen(false)}
          workspaceId={workspaceId}
          workspaceName={workspaceName || 'Workspace'}
          rootPath={rootPath}
        />
      )}
    </>
  )
}

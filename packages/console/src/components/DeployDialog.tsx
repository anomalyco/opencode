import { useState } from 'react'
import type { AFDeployConfig } from '../types'
import { useDeploy } from '../hooks'

interface DeployDialogProps {
  isOpen: boolean
  onClose: () => void
  workspaceId: string
  workspaceName: string
  rootPath: string
}

export default function DeployDialog({
  isOpen,
  onClose,
  workspaceId,
  workspaceName,
  rootPath,
}: DeployDialogProps) {
  const [formData, setFormData] = useState<Partial<AFDeployConfig>>({
    name: workspaceName || 'My App',
    description: '',
    tags: [],
    env: 'dev',
  })
  const [tagInput, setTagInput] = useState('')

  const { isDeploying, progress, deployToAF, lastDeployResult, error } = useDeploy()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name?.trim()) {
      alert('Please enter a name for your deployment')
      return
    }

    const config: AFDeployConfig = {
      workspaceId,
      name: formData.name.trim(),
      description: formData.description?.trim(),
      tags: formData.tags || [],
      env: formData.env || 'dev',
    }

    try {
      await deployToAF(rootPath, config)
      // Keep dialog open to show success state
    } catch (err: any) {
      console.error('Deploy failed:', err)
      // Error is handled by useDeploy hook
    }
  }

  const addTag = () => {
    if (tagInput.trim() && !formData.tags?.includes(tagInput.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...(prev.tags || []), tagInput.trim()],
      }))
      setTagInput('')
    }
  }

  const removeTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags?.filter(tag => tag !== tagToRemove) || [],
    }))
  }

  const handleClose = () => {
    if (isDeploying) return // Don't allow closing during deployment
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Deploy to Agent Foundry</h2>
          {!isDeploying && (
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-white"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Success State */}
        {lastDeployResult && progress?.step === 'completed' && (
          <div className="mb-4">
            <div className="bg-green-900/20 border border-green-700 rounded p-4 mb-4">
              <div className="flex items-center mb-2">
                <svg className="w-5 h-5 text-green-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-green-400 font-medium">Deployment Successful!</span>
              </div>
              <div className="space-y-2 text-sm text-gray-300">
                <div>
                  <span className="text-gray-400">Artifact ID:</span> {lastDeployResult.artifactId}
                </div>
                <div>
                  <span className="text-gray-400">Version:</span> {lastDeployResult.version}
                </div>
                <div>
                  <a
                    href={lastDeployResult.shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 underline"
                  >
                    View Live App →
                  </a>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(lastDeployResult.shareUrl)}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors text-sm"
              >
                Copy Share URL
              </button>
              <button
                onClick={handleClose}
                className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors text-sm"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && progress?.step === 'error' && (
          <div className="bg-red-900/20 border border-red-700 rounded p-4 mb-4">
            <div className="flex items-center mb-2">
              <svg className="w-5 h-5 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-red-400 font-medium">Deployment Failed</span>
            </div>
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Progress State */}
        {isDeploying && progress && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-300">{progress.message}</span>
              <span className="text-sm text-gray-400">{progress.progress}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
            <div className="text-xs text-gray-400 mt-1 capitalize">
              {progress.step.replace('_', ' ')}...
            </div>
          </div>
        )}

        {/* Form */}
        {!lastDeployResult && progress?.step !== 'completed' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                App Name *
              </label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                placeholder="My Awesome App"
                disabled={isDeploying}
                required
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Description
              </label>
              <textarea
                value={formData.description || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                placeholder="Brief description of your app..."
                rows={3}
                disabled={isDeploying}
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Tags
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  className="flex-1 px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                  placeholder="Add a tag..."
                  disabled={isDeploying}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addTag()
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={addTag}
                  className="px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors disabled:opacity-50"
                  disabled={isDeploying || !tagInput.trim()}
                >
                  Add
                </button>
              </div>
              {formData.tags && formData.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {formData.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-blue-900/30 text-blue-300 text-xs rounded"
                    >
                      {tag}
                      {!isDeploying && (
                        <button
                          type="button"
                          onClick={() => removeTag(tag)}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Environment */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Environment
              </label>
              <select
                value={formData.env}
                onChange={(e) => setFormData(prev => ({ ...prev, env: e.target.value as 'dev' | 'staging' | 'prod' }))}
                className="w-full px-3 py-2 bg-gray-700 text-white border border-gray-600 rounded focus:outline-none focus:border-blue-500"
                disabled={isDeploying}
              >
                <option value="dev">Development</option>
                <option value="staging">Staging</option>
                <option value="prod">Production</option>
              </select>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors disabled:opacity-50"
                disabled={isDeploying}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50"
                disabled={isDeploying || !formData.name?.trim()}
              >
                {isDeploying ? 'Deploying...' : 'Deploy'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
import { useState, useCallback, useEffect } from 'react'
import { FileTree } from './'
import { useCodeMirror, useOpenFiles } from '../hooks'

interface CodeTabProps {
  workspaceId?: string
  rootPath?: string
}

export default function CodeTab({ workspaceId, rootPath }: CodeTabProps) {
  const [error, setError] = useState<string | null>(null)

  const {
    openFiles,
    activeFile,
    activeFilePath,
    dirtyFilesCount,
    openFile,
    closeFile,
    saveFile,
    updateFileContent,
    setActiveFile,
  } = useOpenFiles()

  const language = activeFile ? activeFile.name.split('.').pop() : undefined

  const codeEditor = useCodeMirror({
    value: activeFile?.content || '',
    language: activeFile ? activeFile.name.split('.').pop() : undefined,
    onChange: (newContent) => {
      if (activeFile) {
        updateFileContent(activeFile.path, newContent)
      }
    },
    onSave: () => {
      if (activeFilePath) {
        handleSave(activeFilePath)
      }
    },
  })

  const { ref: editorRef } = codeEditor

  // Handle file selection from tree
  const handleFileSelect = useCallback(async (filePath: string) => {
    try {
      setError(null)
      await openFile(filePath)
    } catch (err: any) {
      setError(err.message || 'Failed to open file')
    }
  }, [openFile])

  // Handle file save
  const handleSave = useCallback(async (filePath?: string) => {
    try {
      setError(null)
      await saveFile(filePath)
    } catch (err: any) {
      setError(err.message || 'Failed to save file')
    }
  }, [saveFile])

  // Handle file close
  const handleCloseFile = useCallback(async (filePath: string) => {
    try {
      await closeFile(filePath)
    } catch (err: any) {
      setError(err.message || 'Failed to close file')
    }
  }, [closeFile])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S or Cmd+S to save current file
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (activeFilePath) {
          handleSave(activeFilePath)
        }
      }
      // Ctrl+W or Cmd+W to close current file
      else if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault()
        if (activeFilePath) {
          handleCloseFile(activeFilePath)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeFilePath, handleSave, handleCloseFile])

  if (!workspaceId || !rootPath) {
    return (
      <div className="flex h-full">
        {/* File Tree Placeholder */}
        <div className="w-64 bg-gray-800 border-r border-gray-700">
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            <div className="text-center">
              <div className="text-gray-500 mb-2">
                <svg className="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </div>
              <p>No workspace opened</p>
            </div>
          </div>
        </div>

        {/* Editor Placeholder */}
        <div className="flex-1 bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <div className="text-gray-500 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            </div>
            <p className="text-gray-400 text-sm">Open a workspace to start coding</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* File Tree */}
      <div className="w-64 bg-gray-800 border-r border-gray-700">
        <FileTree
          rootPath={rootPath}
          onFileSelect={handleFileSelect}
          selectedFile={activeFilePath}
        />
      </div>

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col bg-gray-900">
        {/* File Tabs */}
        {openFiles.length > 0 && (
          <div className="flex items-center bg-gray-800 border-b border-gray-700 min-h-[40px] overflow-x-auto">
            {openFiles.map((file) => (
              <div
                key={file.path}
                className={`flex items-center gap-2 px-3 py-2 border-r border-gray-700 cursor-pointer group min-w-0 ${
                  file.path === activeFilePath
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-400 hover:text-gray-300 hover:bg-gray-750'
                }`}
                onClick={() => setActiveFile(file.path)}
              >
                {/* File name */}
                <span className={`text-sm truncate ${file.isDirty ? 'font-medium' : ''}`}>
                  {file.name}
                  {file.isDirty && <span className="text-blue-400 ml-1">•</span>}
                </span>

                {/* Close button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCloseFile(file.path)
                  }}
                  className="text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}

            {/* Save indicator */}
            {dirtyFilesCount > 0 && (
              <div className="ml-auto px-3 py-2 text-xs text-yellow-400">
                {dirtyFilesCount} unsaved
              </div>
            )}
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-red-900/20 border-b border-red-700 px-4 py-2">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Editor */}
        <div className="flex-1 relative">
          {activeFile ? (
            <>
              {/* CodeMirror Editor */}
              <div ref={editorRef} className="absolute inset-0" />

              {/* Save Button (when dirty) */}
              {activeFile.isDirty && (
                <button
                  onClick={() => handleSave(activeFile.path)}
                  className="absolute top-4 right-4 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition-colors"
                >
                  Save (Ctrl+S)
                </button>
              )}
            </>
          ) : (
            /* No File Selected */
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <div className="text-gray-500 mb-4">
                  <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                </div>
                <p className="text-gray-400 text-sm mb-2">Select a file to start editing</p>
                <p className="text-gray-500 text-xs">
                  Use the file tree on the left to open files
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Status Bar */}
        {activeFile && (
          <div className="bg-gray-800 border-t border-gray-700 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <span>{activeFile.name}</span>
              <span>•</span>
              <span>{language ? language.toUpperCase() : 'Plain Text'}</span>
              {activeFile.isDirty && (
                <>
                  <span>•</span>
                  <span className="text-yellow-400">Unsaved</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {activeFile.isDirty && (
                <button
                  onClick={() => handleSave(activeFile.path)}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Save
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
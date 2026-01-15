import { memo } from 'react'
import type { FileItem } from '../types/fs'

interface FileTreeProps {
  rootPath?: string
  onFileSelect?: (filePath: string) => void
  selectedFile?: string
}

interface FileTreeItemProps {
  item: FileItem
  level: number
  isSelected: boolean
  isExpanded: boolean
  onToggleFolder: (path: string) => void
  onSelectFile: (path: string) => void
  children: FileItem[]
}

// File type icons
const getFileIcon = (fileName: string, isDir: boolean) => {
  if (isDir) {
    return '📁'
  }

  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'js':
    case 'jsx':
      return '📄'
    case 'ts':
    case 'tsx':
      return '📘'
    case 'html':
      return '🌐'
    case 'css':
    case 'scss':
    case 'sass':
      return '🎨'
    case 'json':
      return '📊'
    case 'md':
      return '📝'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
      return '🖼️'
    case 'pdf':
      return '📕'
    default:
      return '📄'
  }
}

const FileTreeItem = memo<FileTreeItemProps>(({
  item,
  level,
  isSelected,
  isExpanded,
  onToggleFolder,
  onSelectFile,
  children,
}) => {
  const handleClick = () => {
    if (item.is_dir) {
      onToggleFolder(item.path)
    } else {
      onSelectFile(item.path)
    }
  }

  const paddingLeft = `${level * 16 + 8}px`

  return (
    <div>
      {/* File/Folder Item */}
      <div
        className={`flex items-center gap-2 py-1 px-2 cursor-pointer text-sm hover:bg-gray-700 ${
          isSelected ? 'bg-blue-600 text-white' : 'text-gray-300'
        }`}
        style={{ paddingLeft }}
        onClick={handleClick}
      >
        {/* Expansion arrow for directories */}
        {item.is_dir && (
          <span
            className={`text-gray-400 transition-transform ${
              isExpanded ? 'transform rotate-90' : ''
            }`}
          >
            ▶
          </span>
        )}

        {/* File/Folder icon */}
        <span className="text-sm">
          {item.is_dir && isExpanded ? '📂' : getFileIcon(item.name, item.is_dir)}
        </span>

        {/* File/Folder name */}
        <span className={`flex-1 truncate ${item.is_dir ? 'font-medium' : ''}`}>
          {item.name}
        </span>

        {/* File size for files */}
        {!item.is_dir && item.size !== undefined && (
          <span className="text-xs text-gray-500">
            {formatFileSize(item.size)}
          </span>
        )}
      </div>

      {/* Children (for expanded directories) */}
      {item.is_dir && isExpanded && children.length > 0 && (
        <div>
          {children.map(child => (
            <FileTreeItemContainer
              key={child.path}
              item={child}
              level={level + 1}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  )
})

// Container component that handles loading children
interface FileTreeItemContainerProps {
  item: FileItem
  level: number
  onToggleFolder: (path: string) => void
  onSelectFile: (path: string) => void
}

const FileTreeItemContainer = memo<FileTreeItemContainerProps>(({
  item,
  level,
  onToggleFolder,
  onSelectFile,
}) => {
  const {
    selectedFile,
    getDirectoryItems,
    isFolderExpanded
  } = useFileTree({
    rootPath: undefined, // We're not managing root here
    onFileSelect: onSelectFile
  })

  const isSelected = selectedFile === item.path
  const isExpanded = item.is_dir ? isFolderExpanded(item.path) : false
  const children = item.is_dir ? getDirectoryItems(item.path) : []

  return (
    <FileTreeItem
      item={item}
      level={level}
      isSelected={isSelected}
      isExpanded={isExpanded}
      onToggleFolder={onToggleFolder}
      onSelectFile={onSelectFile}
      children={children}
    />
  )
})

// Format file size helper
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export default function FileTree({ rootPath, onFileSelect }: FileTreeProps) {
  const {
    rootItems,
    isLoading,
    error,
    toggleFolder,
    selectFile
  } = useFileTree({
    rootPath,
    onFileSelect
  })

  if (!rootPath) {
    return (
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
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm p-4">
        <div className="text-center">
          <div className="text-red-500 mb-2">
            <svg className="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="mb-2">Failed to load directory</p>
          <p className="text-xs text-gray-500">{error}</p>
        </div>
      </div>
    )
  }

  if (isLoading && rootItems.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        <div className="text-center">
          <div className="text-gray-500 mb-2 animate-spin">
            <svg className="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <p>Loading files...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-800">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700 bg-gray-850">
        <h3 className="text-sm font-medium text-gray-300">Files</h3>
      </div>

      {/* File Tree */}
      <div className="py-1">
        {rootItems.map(item => (
          <FileTreeItemContainer
            key={item.path}
            item={item}
            level={0}
            onToggleFolder={toggleFolder}
            onSelectFile={selectFile}
          />
        ))}

        {rootItems.length === 0 && !isLoading && (
          <div className="px-4 py-8 text-center text-gray-500 text-sm">
            <p>No files found</p>
          </div>
        )}
      </div>
    </div>
  )
}

// Need to import at the bottom to avoid circular dependency
import { useFileTree } from '../hooks/useFileTree'
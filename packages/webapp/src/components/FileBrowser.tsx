import { For, Show, createSignal, onMount } from "solid-js"
import {
  files,
  currentPath,
  isLoadingFiles,
  searchQuery,
  searchResults,
  loadDirectory,
  navigateUp,
  openFile,
  searchFiles,
  initializeFileBrowser,
  type FileNode,
} from "../stores/files"

export function FileBrowser() {
  const [searchMode, setSearchMode] = createSignal(false)

  onMount(() => {
    initializeFileBrowser()
  })

  const handleFileClick = async (file: FileNode) => {
    if (file.type === "directory") {
      await loadDirectory(file.path)
    } else {
      await openFile(file.path)
    }
  }

  const handleSearch = async (e: Event) => {
    e.preventDefault()
    const query = searchQuery()
    if (query.trim()) {
      await searchFiles(query)
      setSearchMode(true)
    }
  }

  const clearSearch = () => {
    setSearchMode(false)
    searchFiles("")
  }

  return (
    <div class="flex flex-col h-full bg-gray-900 border-r border-gray-800">
      {/* Header */}
      <div class="p-3 border-b border-gray-800">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm font-semibold text-gray-100">Files</h3>
          <button
            class="p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded"
            onClick={navigateUp}
            title="Go up one directory"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 15l7-7 7 7"
              />
            </svg>
          </button>
        </div>

        {/* Current Path */}
        <div class="text-xs text-gray-500 truncate mb-2" title={currentPath()}>
          {currentPath()}
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} class="relative">
          <input
            type="text"
            value={searchQuery()}
            onInput={(e) => searchFiles(e.currentTarget.value)}
            placeholder="Search files..."
            class="w-full px-3 py-1.5 pr-8 text-xs bg-gray-800 border border-gray-700 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <Show when={searchQuery()}>
            <button
              type="button"
              onClick={clearSearch}
              class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </Show>
        </form>
      </div>

      {/* File List */}
      <div class="flex-1 overflow-y-auto">
        <Show
          when={!isLoadingFiles()}
          fallback={
            <div class="p-4 text-center text-gray-500">
              <div class="animate-spin inline-block w-5 h-5 border-2 border-gray-600 border-t-primary-500 rounded-full" />
              <p class="mt-2 text-xs">Loading...</p>
            </div>
          }
        >
          <Show
            when={searchMode() && searchResults().length > 0}
            fallback={
              <Show
                when={files().length > 0}
                fallback={
                  <div class="p-4 text-center text-gray-500 text-xs">
                    <p>No files in this directory</p>
                  </div>
                }
              >
                <For each={files()}>
                  {(file) => (
                    <FileItem file={file} onClick={() => handleFileClick(file)} />
                  )}
                </For>
              </Show>
            }
          >
            <div class="p-2">
              <div class="text-xs text-gray-400 mb-2 px-2">
                {searchResults().length} result(s)
              </div>
              <For each={searchResults()}>
                {(path) => (
                  <button
                    class="w-full text-left px-2 py-1.5 text-xs text-gray-300 hover:bg-gray-800 rounded flex items-center gap-2"
                    onClick={() => openFile(path)}
                  >
                    <FileIcon type="file" />
                    <span class="truncate">{path}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}

interface FileItemProps {
  file: FileNode
  onClick: () => void
}

function FileItem(props: FileItemProps) {
  const formatSize = (bytes?: number) => {
    if (!bytes) return ""
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }

  return (
    <button
      class="w-full text-left px-3 py-2 hover:bg-gray-800 border-b border-gray-800/50 transition-colors group"
      onClick={props.onClick}
    >
      <div class="flex items-center gap-2">
        <FileIcon type={props.file.type} />
        <div class="flex-1 min-w-0">
          <div class="text-sm text-gray-200 truncate">{props.file.name}</div>
          <Show when={props.file.size !== undefined}>
            <div class="text-xs text-gray-500">{formatSize(props.file.size)}</div>
          </Show>
        </div>
        <Show when={props.file.type === "directory"}>
          <svg
            class="w-4 h-4 text-gray-500 group-hover:text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </Show>
      </div>
    </button>
  )
}

function FileIcon(props: { type: "file" | "directory" }) {
  return (
    <Show
      when={props.type === "directory"}
      fallback={
        <svg
          class="w-4 h-4 text-gray-400 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
      }
    >
      <svg
        class="w-4 h-4 text-primary-400 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
        />
      </svg>
    </Show>
  )
}

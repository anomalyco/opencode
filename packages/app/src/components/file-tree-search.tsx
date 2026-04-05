import { Component, createSignal, createEffect, Show, For } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { useFile } from "@/context/file"
import type { FileNode } from "@opencode-ai/sdk/v2"

export interface FileTreeSearchProps {
  class?: string
  onFileSelect: (file: FileNode) => void
}

export function FileTreeSearch(props: FileTreeSearchProps) {
  const file = useFile()
  const [searchQuery, setSearchQuery] = createSignal("")
  const [searchResults, setSearchResults] = createSignal<FileNode[]>([])
  const [isSearching, setIsSearching] = createSignal(false)

  createEffect(() => {
    const query = searchQuery().trim()
    if (!query) {
      setSearchResults([])
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    
    // 模拟搜索延迟
    const timer = setTimeout(async () => {
      try {
        const results = await file.searchFilesAndDirectories(query)
        // 转换搜索结果为 FileNode 格式
        const nodes: FileNode[] = await Promise.all(
          results.map(async (path) => {
            const stats = await file.stat(path)
            return {
              name: path.split("/").pop() || path,
              path,
              absolute: path,
              type: stats.isDirectory() ? "directory" : "file",
              ignored: false
            }
          })
        )
        setSearchResults(nodes)
      } catch (error) {
        console.error("Search error:", error)
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  })

  return (
    <div class={`relative ${props.class || ""}`}>
      <div class="relative">
        <Icon 
          name="search" 
          class="absolute left-3 top-1/2 -translate-y-1/2 text-icon-weak" 
          size="small" 
        />
        <input
          type="text"
          placeholder="Search files..."
          value={searchQuery()}
          onInput={(e) => setSearchQuery(e.target.value)}
          class="w-full pl-9 pr-4 py-2 rounded-md bg-surface-base border border-border-weak-base text-text-strong placeholder-text-weak focus:outline-none focus:border-icon-info-active"
          aria-label="Search files"
        />
        <Show when={searchQuery()}
          <Button
            variant="ghost"
            size="small"
            icon="x"
            onClick={() => setSearchQuery("")}
            class="absolute right-1 top-1/2 -translate-y-1/2"
            aria-label="Clear search"
          />
        </Show>
      </div>
      
      <Show when={searchQuery() && searchResults().length > 0}>
        <div class="absolute top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-surface-base border border-border-strong-base rounded-md shadow-lg z-10">
          <For each={searchResults()}>
            {(node) => (
              <button
                class="w-full text-left px-3 py-2 hover:bg-surface-base-hover transition-colors"
                onClick={() => props.onFileSelect(node)}
              >
                <div class="flex items-center gap-2">
                  <div class="w-4">
                    <Icon 
                      name={node.type === "directory" ? "folder" : "file"} 
                      size="small" 
                      class="text-icon-weak"
                    />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-12-medium text-text-strong truncate">
                      {node.name}
                    </div>
                    <div class="text-10-regular text-text-weak truncate">
                      {node.path}
                    </div>
                  </div>
                </div>
              </button>
            )}
          </For>
        </div>
      </Show>
      
      <Show when={searchQuery() && searchResults().length === 0 && !isSearching()}>
        <div class="absolute top-full left-0 right-0 mt-1 p-4 bg-surface-base border border-border-strong-base rounded-md shadow-lg z-10">
          <div class="text-center text-text-weak">
            No files found matching "{searchQuery()}"
          </div>
        </div>
      </Show>
    </div>
  )
}

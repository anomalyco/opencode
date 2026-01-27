import { Component, For, Show, createSignal, onMount, createMemo } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useFile } from "@/context/file"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { Icon } from "@opencode-ai/ui/icon"
import { Collapsible } from "@opencode-ai/ui/collapsible"
import type { FileNode } from "@opencode-ai/sdk/v2"

export const FilesPanel: Component = () => {
  const sdk = useSDK()
  const file = useFile()
  const [fileList, setFileList] = createSignal<FileNode[]>([])
  const [childFiles, setChildFiles] = createSignal<Record<string, FileNode[]>>({})
  const [loading, setLoading] = createSignal(true)
  const [expandedDirs, setExpandedDirs] = createSignal<Set<string>>(new Set())

  // Initialize file list on mount
  onMount(async () => {
    try {
      setLoading(true)
      const response = await sdk.client.file.list({ path: "" })
      if (response.data) {
        setFileList(response.data)
      }
    } catch (error) {
      console.error("Failed to load file list:", error)
    } finally {
      setLoading(false)
    }
  })

  // Load child files for a directory
  const loadChildFiles = async (path: string) => {
    if (childFiles()[path]) return // Already loaded

    try {
      const response = await sdk.client.file.list({ path: path + "/" })
      if (response.data) {
        setChildFiles((prev) => ({ ...prev, [path]: response.data }))
      }
    } catch (error) {
      console.error(`Failed to load files for ${path}:`, error)
    }
  }

  // Toggle directory expansion
  const toggleDirectory = (path: string) => {
    const current = expandedDirs()
    if (current.has(path)) {
      // Collapse
      const next = new Set(current)
      next.delete(path)
      setExpandedDirs(next)
    } else {
      // Expand
      const next = new Set(current)
      next.add(path)
      setExpandedDirs(next)
      loadChildFiles(path)
    }
  }

  // Filter and sort files
  const sortedFiles = createMemo(() => {
    const files = fileList()
    return files.sort((a, b) => {
      // Directories first
      if (a.type === "directory" && b.type !== "directory") return -1
      if (a.type !== "directory" && b.type === "directory") return 1
      // Then by name
      return a.name.localeCompare(b.name)
    })
  })

  // Handle file click - open in new tab using original project's mechanism
  const handleFileClick = (clickedFile: FileNode) => {
    if (clickedFile.type !== "file") return

    // Check if file is a text or code file
    const textExtensions = [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".json",
      ".md",
      ".txt",
      ".py",
      ".rs",
      ".go",
      ".java",
      ".c",
      ".cpp",
      ".h",
      ".css",
      ".scss",
      ".html",
      ".xml",
      ".yaml",
      ".yml",
      ".toml",
      ".ini",
      ".sh",
      ".bash",
      ".zsh",
      ".fish",
      ".ps1",
      ".sql",
      ".graphql",
      ".vue",
      ".svelte",
    ]

    const isTextFile =
      textExtensions.some((ext) => clickedFile.name.endsWith(ext)) || clickedFile.name.indexOf(".") === -1

    if (!isTextFile) return

    // Use the original project's file opening mechanism
    const tabValue = file.tab(clickedFile.path)

    // Emit custom event to open tab (session.tsx will handle this)
    window.dispatchEvent(
      new CustomEvent("open-file-tab", {
        detail: { path: clickedFile.path, tabValue },
      })
    )
  }

  // Recursive component to render file tree
  const FileTreeNode = (props: {
    nodes: FileNode[];
    level?: number;
    parentPath?: string
  }) => {
    const level = props.level ?? 0
    const paddingLeft = level * 16

    return (
      <For each={props.nodes}>
        {(node) => (
          <Show
            when={node.type === "directory"}
            fallback={
              <div
                class="flex items-center gap-2 px-2 py-1.5 hover:bg-background-element rounded cursor-pointer text-13-regular text-text-primary"
                onClick={() => handleFileClick(node)}
                style={{ "padding-left": `${paddingLeft + 8}px` }}
              >
                <div class="w-4 shrink-0" />
                <FileIcon node={node} class="w-4 h-4 shrink-0" />
                <span class="truncate">{node.name}</span>
              </div>
            }
          >
            <Collapsible
              open={expandedDirs().has(node.path)}
              onOpenChange={() => toggleDirectory(node.path)}
            >
              <Collapsible.Trigger
                as="div"
                class="flex items-center gap-2 px-2 py-1.5 hover:bg-background-element rounded cursor-pointer text-13-regular text-text-weak"
                style={{ "padding-left": `${paddingLeft + 8}px` }}
              >
                <Collapsible.Arrow class="text-text-muted/60 shrink-0" />
                <FileIcon node={node} class="w-4 h-4 shrink-0" />
                <span class="truncate">{node.name}</span>
              </Collapsible.Trigger>
              <Collapsible.Content>
                <Show when={childFiles()[node.path]}>
                  <FileTreeNode
                    nodes={childFiles()[node.path] ?? []}
                    level={level + 1}
                    parentPath={node.path}
                  />
                </Show>
              </Collapsible.Content>
            </Collapsible>
          </Show>
        )}
      </For>
    )
  }

  return (
    <div class="flex flex-col h-full">
      <div class="flex-1 overflow-auto">
        <Show
          when={!loading()}
          fallback={
            <div class="px-4 py-8 text-center text-text-weak text-13-regular">
              Loading files...
            </div>
          }
        >
          <div class="px-4 py-2">
            <h3 class="text-14-medium text-text-strong mb-2">Project Files</h3>
            <Show
              when={sortedFiles().length > 0}
              fallback={<div class="text-text-weak text-13-regular">No files found</div>}
            >
              <FileTreeNode nodes={sortedFiles()} />
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}

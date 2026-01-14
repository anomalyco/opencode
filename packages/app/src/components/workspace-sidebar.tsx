import { Show, createSignal, createEffect, on } from "solid-js"
import { useLayout } from "@/context/layout"
import { useLocal, type LocalFile } from "@/context/local"
import FileTree from "./file-tree"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { getPreviewType } from "./file-preview"

export interface WorkspaceSidebarProps {
  workspacePath: string
  class?: string
  onFileActivate?: (filePath: string) => void
}

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const layout = useLayout()
  const local = useLocal()
  const [selectedFile, setSelectedFile] = createSignal<LocalFile | null>(null)

  // Load root directory files when workspace path changes or component mounts
  createEffect(
    on(
      () => props.workspacePath,
      (path) => {
        if (path) {
          // Load root directory files
          local.file.loadRoot()
        }
      },
      { defer: false }
    )
  )

  const handleFileClick = (file: LocalFile) => {
    setSelectedFile(file)
    // Open preview in main content area if it's a supported type
    if (file.type === "file" && getPreviewType(file.name)) {
      layout.filePreview.open(file.path)
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setSelectedFile(null)
      layout.filePreview.close()
    }
  }

  // Use empty string as root path (relative to project directory)
  const rootPath = ""

  const isEmpty = () => {
    const children = local.file.children(rootPath)
    // Filter out hidden files for the empty check
    const visibleChildren = children.filter((node) => !node.name.startsWith("."))
    return !visibleChildren || visibleChildren.length === 0
  }

  return (
    <div
      class={`flex flex-col border-l border-border-weak-base glass-sidebar ${props.class ?? ""}`}
      onKeyDown={handleKeyDown}
      role="tree"
      aria-label="Workspace files"
    >
      {/* Header - h-12 to match main header */}
      <div class="h-12 px-3 border-b border-border-weak-base flex items-center justify-between shrink-0 vibrancy">
        <span class="text-12-medium text-text-base font-medium">Files</span>
        <IconButton
          icon="close"
          size="normal"
          variant="ghost"
          onClick={() => layout.workspaceSidebar.close()}
          aria-label="Close workspace files"
        />
      </div>

      {/* File Tree Content */}
      <div class="flex-1 overflow-y-auto min-h-0">
        <Show
          when={!isEmpty()}
          fallback={
            <div class="p-4 text-center text-text-muted text-sm">
              No files in workspace
            </div>
          }
        >
          <FileTree
            path={rootPath}
            workspacePath={props.workspacePath}
            selectedPath={selectedFile()?.path}
            onFileClick={handleFileClick}
            onFileActivate={(file) => props.onFileActivate?.(file.path)}
            class="py-2 px-1"
          />
        </Show>
      </div>
    </div>
  )
}

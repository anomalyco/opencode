import { Show, createSignal, createEffect, on, onCleanup, createMemo } from "solid-js"
import { useLayout } from "@/context/layout"
import { useLocal, type LocalFile } from "@/context/local"
import { useFileActivity } from "@/context/file-activity"
import FileTree from "./file-tree"
import { FileActivitySection } from "./file-activity-section"
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
  const fileActivity = useFileActivity()
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

  // Subscribe to file activity events to refresh the file tree
  createEffect(() => {
    const unsub = fileActivity.subscribe((event) => {
      // When a file is created or edited, refresh the parent directory
      if (event.activityType === "created" || event.activityType === "edited") {
        // Get the relative path from the absolute path
        const relativePath = local.file.relative(event.path)
        const parentPath = relativePath.split("/").slice(0, -1).join("/")

        // Refresh the parent directory to show the new/updated file
        local.file.refreshDir(parentPath)
      }
    })
    onCleanup(unsub)
  })

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

  // Check if there are any activity files to show
  const hasActivityFiles = createMemo(() => {
    return fileActivity.getAllPaths().length > 0
  })

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
        {/* Activity Sections - Show changed and referenced files */}
        <Show when={hasActivityFiles()}>
          <div class="py-2 px-1 border-b border-border-weak-base">
            <FileActivitySection
              type="changed"
              selectedPath={selectedFile()?.path}
              onFileClick={handleFileClick}
              onFileActivate={(file) => props.onFileActivate?.(file.path)}
            />
            <FileActivitySection
              type="referenced"
              selectedPath={selectedFile()?.path}
              onFileClick={handleFileClick}
              onFileActivate={(file) => props.onFileActivate?.(file.path)}
            />
          </div>
        </Show>

        {/* Full File Tree */}
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
            hideActivityFiles={hasActivityFiles()}
            onFileClick={handleFileClick}
            onFileActivate={(file) => props.onFileActivate?.(file.path)}
            class="py-2 px-1"
          />
        </Show>
      </div>
    </div>
  )
}

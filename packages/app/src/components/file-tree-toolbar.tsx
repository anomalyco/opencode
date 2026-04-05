import { Component, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { useFile } from "@/context/file"

export interface FileTreeToolbarProps {
  class?: string
  path: string
  onRefresh?: () => void
  onNewFile?: () => void
  onNewFolder?: () => void
  onUpload?: () => void
}

export function FileTreeToolbar(props: FileTreeToolbarProps) {
  const file = useFile()

  const handleExpandAll = () => {
    file.tree.expandAll(props.path)
  }

  const handleCollapseAll = () => {
    file.tree.collapseAll(props.path)
  }

  return (
    <div class={`flex items-center gap-1 p-2 border-b border-border-weak-base ${props.class || ""}`}>
      <IconButton
        icon="refresh-cw"
        variant="ghost"
        size="small"
        onClick={props.onRefresh || (() => file.tree.reload(props.path))}
        aria-label="Refresh file tree"
      />
      
      <div class="h-6 w-px bg-border-weak-base mx-1" />
      
      <IconButton
        icon="folder-plus"
        variant="ghost"
        size="small"
        onClick={props.onNewFolder}
        aria-label="New folder"
        disabled={!props.onNewFolder}
      />
      
      <IconButton
        icon="file-plus"
        variant="ghost"
        size="small"
        onClick={props.onNewFile}
        aria-label="New file"
        disabled={!props.onNewFile}
      />
      
      <IconButton
        icon="upload"
        variant="ghost"
        size="small"
        onClick={props.onUpload}
        aria-label="Upload file"
        disabled={!props.onUpload}
      />
      
      <div class="flex-1" />
      
      <IconButton
        icon="chevrons-down"
        variant="ghost"
        size="small"
        onClick={handleExpandAll}
        aria-label="Expand all"
      />
      
      <IconButton
        icon="chevrons-up"
        variant="ghost"
        size="small"
        onClick={handleCollapseAll}
        aria-label="Collapse all"
      />
    </div>
  )
}

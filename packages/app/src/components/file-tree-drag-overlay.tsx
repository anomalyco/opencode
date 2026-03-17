import { Component, Show } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"

type FileTreeDragOverlayProps = {
  active: boolean
  label: string
}

export const FileTreeDragOverlay: Component<FileTreeDragOverlayProps> = (props) => {
  return (
    <Show when={props.active}>
      <div class="absolute inset-0 z-50 flex items-center justify-center bg-surface-raised-stronger-non-alpha/90 pointer-events-none border-2 border-dashed border-primary-base m-2 rounded-lg">
        <div class="flex flex-col items-center gap-3 text-text-weak">
          <Icon name="folder" class="size-10" />
          <span class="text-14-medium">{props.label}</span>
          <span class="text-12-regular text-text-weaker">Drop files to upload</span>
        </div>
      </div>
    </Show>
  )
}

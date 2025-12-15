import { Component } from "solid-js"
import { useLocal } from "@/context/local"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { getDirectory, getFilename } from "@opencode-ai/util/path"

export const DialogFileSelect: Component<{
  onOpenChange?: (open: boolean) => void
  onSelect?: (path: string) => void
}> = (props) => {
  const local = useLocal()
  let closeButton!: HTMLButtonElement

  return (
    <Dialog modal defaultOpen onOpenChange={props.onOpenChange}>
      <Dialog.Header>
        <Dialog.Title>Select file</Dialog.Title>
        <Dialog.CloseButton ref={closeButton} tabIndex={-1} />
      </Dialog.Header>
      <Dialog.Body>
        <List
          class="px-2.5"
          search={{ placeholder: "Search files", autofocus: true }}
          emptyMessage="No files found"
          items={local.file.searchFiles}
          key={(x) => x}
          onSelect={(x) => {
            if (x) {
              props.onSelect?.(x)
            }
            closeButton.click()
          }}
        >
          {(i) => (
            <div class="w-full flex items-center justify-between rounded-md">
              <div class="flex items-center gap-x-2 grow min-w-0">
                <FileIcon node={{ path: i, type: "file" }} class="shrink-0 size-4" />
                <div class="flex items-center text-14-regular">
                  <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                    {getDirectory(i)}
                  </span>
                  <span class="text-text-strong whitespace-nowrap">{getFilename(i)}</span>
                </div>
              </div>
            </div>
          )}
        </List>
      </Dialog.Body>
    </Dialog>
  )
}

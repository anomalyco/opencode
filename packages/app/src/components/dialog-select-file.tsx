import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { List } from "@opencode-ai/ui/list"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"
import { useLayout } from "@/context/layout"
import { useFile } from "@/context/file"

export function DialogSelectFile() {
  const layout = useLayout()
  const file = useFile()
  const dialog = useDialog()
  const params = useParams()
  const sessionKey = createMemo(() => `${params.dir}${params.id ? "/" + params.id : ""}`)
  const tabs = createMemo(() => layout.tabs(sessionKey()))
  const view = createMemo(() => layout.view(sessionKey()))
  return (
    <Dialog title="Select file">
      <List
        search={{ placeholder: "Search files", autofocus: true }}
        emptyMessage="No files found"
        items={file.searchFiles}
        key={(x) => x}
        onSelect={(path) => {
          if (path) {
            const value = file.tab(path)
            tabs().open(value)
            file.load(path)
            view().reviewPanel.open()
          }
          dialog.close()
        }}
      >
        {(i) => (
          <div class="w-full flex items-center justify-between rounded-md">
            <div class="flex items-center gap-x-3 grow min-w-0">
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
    </Dialog>
  )
}

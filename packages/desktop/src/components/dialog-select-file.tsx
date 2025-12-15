import { useLocal } from "@/context/local"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { useSession } from "@/context/session"
import { useDialog } from "@opencode-ai/ui/context/dialog"

export function DialogSelectFile() {
  const session = useSession()
  const local = useLocal()
  const dialog = useDialog()
  return (
    <Dialog title="Select file">
      <List
        class="px-2.5"
        search={{ placeholder: "Search files", autofocus: true }}
        emptyMessage="No files found"
        items={local.file.searchFiles}
        key={(x) => x}
        onSelect={(path) => {
          if (path) {
            session.layout.openTab("file://" + path)
          }
          dialog.clear()
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
    </Dialog>
  )
}

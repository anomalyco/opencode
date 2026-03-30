import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { List } from "@opencode-ai/ui/list"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { useLanguage } from "@/context/language"

export function DialogSelectFileRef(props: { paths: string[]; onSelect: (path: string) => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const items = () => props.paths.map((path) => ({ path }))
  return (
    <Dialog title={language.t("session.header.searchFiles")} transition>
      <List
        search={{ placeholder: language.t("session.header.searchFiles"), autofocus: true, hideIcon: true }}
        emptyMessage={language.t("palette.empty")}
        key={(item) => item.path}
        items={items}
        filterKeys={["path"]}
        onSelect={(item) => {
          if (!item) return
          dialog.close()
          props.onSelect(item.path)
        }}
      >
        {(item) => (
          <div class="w-full flex items-center gap-x-3 rounded-md pl-1">
            <FileIcon node={{ path: item.path, type: "file" }} class="shrink-0 size-4" />
            <div class="flex items-center text-14-regular min-w-0">
              <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                {getDirectory(item.path)}
              </span>
              <span class="text-text-strong whitespace-nowrap">{getFilename(item.path)}</span>
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}

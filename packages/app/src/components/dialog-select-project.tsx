import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { FileIcon } from "@opencode-ai/ui/file-icon"
import { List } from "@opencode-ai/ui/list"
import { base64Encode } from "@opencode-ai/util/encode"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { useNavigate } from "@solidjs/router"
import { createMemo } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"

type Row = {
  directory: string
  name: string
  path: string
  search: string
}

export function DialogSelectProject(props: { onSelect?: (directory: string) => void | Promise<void> }) {
  const dialog = useDialog()
  const language = useLanguage()
  const layout = useLayout()
  const navigate = useNavigate()
  const sync = useGlobalSync()
  const home = createMemo(() => sync.data.path.home)

  const projects = createMemo(() => {
    const base = home()
    return layout.projects.list().map((project) => {
      const path = base ? project.worktree.replace(base, "~") : project.worktree
      const name = project.name || getFilename(project.worktree)
      return {
        directory: project.worktree,
        name,
        path,
        search: `${name}\n${project.worktree}\n${path}`,
      } satisfies Row
    })
  })

  const select = (directory: string) => {
    dialog.close()
    if (props.onSelect) {
      void props.onSelect(directory)
      return
    }
    navigate(`/${base64Encode(directory)}/session`)
  }

  return (
    <Dialog title={language.t("command.project.switch")}>
      <List
        search={{ placeholder: language.t("palette.search.projects.placeholder"), autofocus: true }}
        emptyMessage={language.t("palette.empty")}
        items={projects}
        key={(item) => item.directory}
        filterKeys={["search"]}
        onSelect={(item) => {
          if (!item) return
          select(item.directory)
        }}
      >
        {(item) => (
          <div class="w-full flex items-center justify-between rounded-md">
            <div class="flex items-center gap-x-3 grow min-w-0">
              <FileIcon node={{ path: item.directory, type: "directory" }} class="shrink-0 size-4" />
              <div class="flex items-center text-14-regular min-w-0">
                <span class="text-text-strong whitespace-nowrap mr-2">{item.name}</span>
                <span class="text-text-weak whitespace-nowrap overflow-hidden overflow-ellipsis truncate min-w-0">
                  {getDirectory(item.path)}
                </span>
                <span class="text-text-weak whitespace-nowrap">{getFilename(item.path)}</span>
              </div>
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}

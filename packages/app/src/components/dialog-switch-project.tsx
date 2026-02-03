import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { getFilename } from "@opencode-ai/util/path"
import { useParams } from "@solidjs/router"
import { createMemo, Show } from "solid-js"
import { useLayout, getAvatarColors, type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { Avatar } from "@opencode-ai/ui/avatar"
import { Icon } from "@opencode-ai/ui/icon"
import { decode64 } from "@/utils/base64"

type ProjectEntry = {
  id: string
  name: string
  path: string
  isCurrent: boolean
  project: LocalProject
}

export function DialogSwitchProject(props: { onSelect: (directory: string) => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const layout = useLayout()
  const params = useParams()

  const currentDirectory = createMemo(() => {
    try {
      return decode64(params.dir)
    } catch {
      return undefined
    }
  })

  const entries = createMemo((): ProjectEntry[] => {
    const projects = layout.projects.list()
    const current = currentDirectory()

    return projects.map((project) => ({
      id: project.worktree,
      name: project.name || getFilename(project.worktree),
      path: project.worktree,
      isCurrent: project.worktree === current,
      project,
    }))
  })

  const handleSelect = (entry: ProjectEntry | undefined) => {
    if (!entry) return
    dialog.close()
    props.onSelect(entry.id)
  }

  return (
    <Dialog title={language.t("project.switch.title")}>
      <List
        search={{ placeholder: language.t("project.switch.placeholder"), autofocus: true }}
        emptyMessage={language.t("project.switch.empty")}
        items={entries()}
        key={(item) => item.id}
        filterKeys={["name", "path"]}
        onSelect={handleSelect}
      >
        {(item) => (
          <div class="w-full flex items-center justify-between rounded-md pl-1">
            <div class="flex items-center grow min-w-0">
              <Avatar
                fallback={item.name}
                src={item.project.icon?.override}
                {...getAvatarColors(item.project.icon?.color)}
                class="size-6 rounded shrink-0"
              />
              <span class="text-14-medium text-text-base truncate w-[200px] shrink-0 pl-2">{item.name}</span>
              <span class="text-12-regular text-text-weak truncate grow min-w-0 text-left pl-3">{item.path}</span>
              <Show when={item.isCurrent}>
                <span class="text-12-regular text-text-weak shrink-0 ml-2">
                  {language.t("project.switch.current")}
                </span>
              </Show>
            </div>
            <Show when={item.isCurrent}>
              <Icon name="check" size="small" class="text-icon-success-base shrink-0 ml-2" />
            </Show>
          </div>
        )}
      </List>
    </Dialog>
  )
}

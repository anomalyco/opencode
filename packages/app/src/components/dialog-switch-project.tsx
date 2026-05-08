import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { getFilename } from "@opencode-ai/util/path"
import { createMemo, Show, type Accessor } from "solid-js"
import { useLayout, getAvatarColors, type LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { Avatar } from "@opencode-ai/ui/avatar"
import { Icon, type IconName } from "@opencode-ai/ui/icon"
import { enabledExtraAgents } from "@/pages/layout/extra-agents"

type ProjectItem = {
  kind: "project"
  id: string
  name: string
  path: string
  isCurrent: boolean
  project: LocalProject
}

type ExtraAgentItem = {
  kind: "extra-agent"
  id: string
  name: string
  path: string
  isCurrent: boolean
  icon?: IconName
}

type ProjectEntry = ProjectItem | ExtraAgentItem

export function DialogSwitchProject(props: { onSelect: (directory: string) => void; current: Accessor<string | undefined> }) {
  const dialog = useDialog()
  const language = useLanguage()
  const layout = useLayout()
  const server = useServer()

  const enabledAgents = createMemo(() => enabledExtraAgents(server.list))

  const entries = createMemo((): ProjectEntry[] => {
    const projects = layout.projects.rail()
    const current = props.current()

    const result: ProjectEntry[] = projects.map((project) => ({
      kind: "project",
      id: project.worktree,
      name: project.name || getFilename(project.worktree),
      path: project.worktree,
      isCurrent: project.worktree === current,
      project,
    }))

    for (const agent of enabledAgents().toReversed()) {
      result.unshift({
        kind: "extra-agent",
        id: agent.directory,
        name: agent.label,
        path: agent.directory,
        isCurrent: current === agent.directory,
        icon: agent.icon,
      })
    }

    return result
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
              <Show
                when={item.kind === "project" && item}
                fallback={
                  <div class="size-6 rounded shrink-0 flex items-center justify-center bg-surface-base">
                    <Icon name={item.kind === "extra-agent" ? item.icon ?? "robot" : "robot"} class="text-icon-base size-4" />
                  </div>
                }
              >
                {(entry) => (
                  <Avatar
                    fallback={item.name}
                    src={entry().project.icon?.override}
                    {...getAvatarColors(entry().project.icon?.color)}
                    class="size-6 rounded shrink-0"
                  />
                )}
              </Show>
              <span class="text-14-medium text-text-base truncate w-[200px] shrink-0 pl-4">{item.name}</span>
              <Show when={item.kind === "project"}>
                <span class="text-12-regular text-text-weak truncate grow min-w-0 text-left pl-3">{item.path}</span>
              </Show>
              <Show when={item.isCurrent}>
                <span class="text-12-regular text-text-weak shrink-0 ml-2">{language.t("project.switch.current")}</span>
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

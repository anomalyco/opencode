import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { ProjectAvatar } from "@opencode-ai/ui/v2/project-avatar-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useGlobal } from "@/context/global"
import { getProjectAvatarVariant } from "@/context/layout"
import { ServerConnection, serverName } from "@/context/server"
import { displayName } from "@/pages/layout/helpers"
import { InlineServerSelect } from "./parts/server-select"
import { DialogEditProjectV2 } from "../dialog-edit-project-v2"
import "./settings-v2.css"

export const SettingsProjectsV2: Component = () => {
  const dialog = useDialog()
  const language = useLanguage()
  const global = useGlobal()
  const [allServers, setAllServers] = createSignal(true)
  const selected = global.settings.server.selected
  const projects = createMemo(() => {
    const server = selected()
    if (!server) return []
    return global.ensureServerCtx(server).projects.list()
  })

  type ProjectItem = ReturnType<typeof projects>[number]

  const groups = createMemo(() =>
    global.servers
      .list()
      .map((server) => ({ server, projects: global.ensureServerCtx(server).projects.list() }))
      .filter((group) => group.projects.length > 0),
  )

  const openProjectSettings = (project: ProjectItem, server = selected()) => {
    if (!server) return
    dialog.push(() => <DialogEditProjectV2 project={project} server={server} />)
  }

  const ProjectRow: Component<{ project: ProjectItem; server: ServerConnection.Any }> = (props) => {
    const name = () => displayName(props.project)
    const color = () => getProjectAvatarVariant(props.project.icon?.color)
    return (
      <div
        class="group flex items-center justify-between gap-5 px-4 py-2.5 rounded-lg bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)] cursor-pointer transition-all hover:bg-v2-background-bg-layer-01"
        onClick={() => openProjectSettings(props.project, props.server)}
      >
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          <ProjectAvatar fallback={name()} variant={color()} class="shrink-0" />
          <span class="text-13-medium text-v2-text-text-base truncate">{name()}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButtonV2
            type="button"
            variant="ghost-muted"
            size="small"
            icon={<IconV2 name="settings-gear" size="small" class="text-v2-icon-icon-muted" />}
            onClick={(event: MouseEvent) => {
              event.stopPropagation()
              openProjectSettings(props.project, props.server)
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="settings-v2-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-v2-tab-title">{language.t("settings.projects.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.projects.description")}</span>
          </div>
          <InlineServerSelect
            all={{
              label: language.t("settings.projects.server.all"),
              selected: allServers,
              onSelect: () => setAllServers(true),
            }}
            onServerSelect={() => setAllServers(false)}
          />
        </div>
      </div>

      <div class="settings-v2-tab-body">
        <Show
          when={allServers()}
          fallback={
            <div class="flex flex-col gap-2 w-full">
              <Show
                when={projects().length > 0}
                fallback={
                  <div class="py-12 text-center text-v2-text-text-muted text-13-regular">
                    {language.t("settings.projects.empty")}
                  </div>
                }
              >
                <Show when={selected()} keyed>
                  {(server) => (
                    <For each={projects()}>{(project) => <ProjectRow project={project} server={server} />}</For>
                  )}
                </Show>
              </Show>
            </div>
          }
        >
          <div class="flex flex-col gap-8 w-full">
            <Show
              when={groups().length > 0}
              fallback={
                <div class="py-12 text-center text-v2-text-text-muted text-13-regular">
                  {language.t("settings.projects.empty")}
                </div>
              }
            >
              <For each={groups()}>
                {(group) => (
                  <div class="settings-v2-section">
                    <h3 class="settings-v2-section-title">
                      {serverName(group.server) || ServerConnection.key(group.server)}
                    </h3>
                    <div class="flex flex-col gap-2 w-full">
                      <For each={group.projects}>
                        {(project) => <ProjectRow project={project} server={group.server} />}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </div>
    </>
  )
}

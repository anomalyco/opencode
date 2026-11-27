import type { HomeProjectsController } from "./controller"
import { HomeProjectsView } from "./view"
import type { HomeScrollController } from "../scroll"
import { useSettings } from "@/settings/model"

export function HomeProjects(props: {
  projects: HomeProjectsController
  scroll?: HomeScrollController
  dropdown?: boolean
  scope?: boolean
  /** Runs after a project or server is picked, or a project is added (which selects it). */
  onPick?: () => void
}) {
  const settings = useSettings()

  return (
    <HomeProjectsView
      dropdown={props.dropdown}
      scope={props.scope}
      serverScope={settings.appearance.navigationPrototype()}
      language={props.projects.copy.language}
      servers={props.projects.server.list()}
      projects={props.projects.project.list()}
      selection={props.projects.selection.value()}
      serverHealth={props.projects.server.health}
      serverLabel={props.projects.server.label}
      projectsForServer={props.projects.server.projects}
      collapsed={props.projects.server.collapsed}
      canRevealProject={props.projects.project.canReveal}
      hasUnread={props.projects.project.hasUnread}
      onWheel={(event) => props.scroll?.viewport.containWheel(event)}
      onChooseProject={(server) => {
        props.projects.project.choose(server)
        props.onPick?.()
      }}
      onFocusServer={(server) => {
        props.projects.server.focus(server)
        props.onPick?.()
      }}
      onAuthenticateServer={props.projects.server.authenticate}
      onToggleCollapsed={props.projects.server.toggleCollapsed}
      onEditServer={props.projects.server.edit}
      canRemoveServer={props.projects.server.canRemove}
      onRemoveServer={props.projects.server.remove}
      canHideServer={props.projects.server.canHide}
      onHideServer={props.projects.server.hide}
      onSelectProject={(server, directory) => {
        props.projects.project.select(server, directory)
        props.onPick?.()
      }}
      onOpenProjectNewSession={props.projects.project.openNewSession}
      canImportSession={props.projects.project.canImportSession}
      importingSession={props.projects.project.importingSession()}
      onImportSession={props.projects.project.importSession}
      onEditProject={props.projects.project.edit}
      onRevealProject={props.projects.project.reveal}
      onClearNotifications={props.projects.project.clearNotifications}
      onHideProject={props.projects.project.hide}
      onOpenSettings={props.projects.utility.settings}
      onOpenHelp={props.projects.utility.help}
      automations={props.projects.utility.automations}
    />
  )
}

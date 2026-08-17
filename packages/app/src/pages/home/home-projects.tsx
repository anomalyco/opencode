import type { HomeProjectsController } from "./home-projects-controller"
import { HomeProjectsView } from "./home-projects-view"
import type { HomeScrollController } from "./home-scroll-controller"
import { ServerConnection } from "@/context/servers"
import { createStore } from "solid-js/store"

export function HomeProjects(props: { projects: HomeProjectsController; scroll: HomeScrollController }) {
  const recentMode = new Map<ServerConnection.Key, boolean>()
  const [dismissedRecent, setDismissedRecent] = createStore({} as Record<string, boolean>)
  const showRecentForServer = (server: ServerConnection.Any) => {
    const key = ServerConnection.key(server)
    if (dismissedRecent[key]) return false
    if (recentMode.get(key)) return true
    if (props.projects.server.projects(server).length > 0) return false
    recentMode.set(key, true)
    return true
  }

  return (
    <HomeProjectsView
      language={props.projects.copy.language}
      servers={props.projects.server.list()}
      projects={props.projects.project.list()}
      selection={props.projects.selection.value()}
      serverHealth={props.projects.server.health}
      projectsForServer={props.projects.server.projects}
      recentForServer={props.projects.project.recentForServer}
      showRecentForServer={showRecentForServer}
      onDismissRecent={(server) => setDismissedRecent(ServerConnection.key(server), true)}
      homedirForServer={props.projects.project.homedirForServer}
      collapsed={props.projects.server.collapsed}
      canDefaultServer={props.projects.server.canDefault()}
      defaultServerKey={props.projects.server.defaultKey()}
      canRevealProject={props.projects.project.canReveal}
      unseenCount={props.projects.project.unseenCount}
      onWheel={props.scroll.viewport.containWheel}
      onChooseProject={props.projects.project.choose}
      onFocusServer={props.projects.server.focus}
      onToggleCollapsed={props.projects.server.toggleCollapsed}
      onEditServer={props.projects.server.edit}
      onSetDefaultServer={props.projects.server.setDefault}
      canRemoveServer={props.projects.server.canRemove}
      onRemoveServer={props.projects.server.remove}
      onMoveProject={props.projects.project.move}
      onSelectProject={props.projects.project.select}
      onAddProjects={props.projects.project.add}
      onOpenProjectNewSession={props.projects.project.openNewSession}
      onEditProject={props.projects.project.edit}
      onRevealProject={props.projects.project.reveal}
      onClearNotifications={props.projects.project.clearNotifications}
      onCloseProject={props.projects.project.close}
      onOpenSettings={props.projects.utility.settings}
      onOpenHelp={props.projects.utility.help}
    />
  )
}

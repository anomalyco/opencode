import type { HomeProjectsController } from "./home-projects-controller"
import { HomeProjectsView } from "./home-projects-view"
import type { HomeScrollController } from "./home-scroll-controller"

export function HomeProjects(props: { projects: HomeProjectsController; scroll: HomeScrollController }) {
  return (
    <HomeProjectsView
      language={props.projects.language}
      servers={props.projects.servers}
      projects={props.projects.projects}
      recentlyClosed={props.projects.recentlyClosed}
      selection={props.projects.selection}
      homedir={props.projects.homedir}
      serverHealth={props.projects.serverHealth}
      projectsForServer={props.projects.projectsForServer}
      collapsed={props.projects.collapsed}
      menuOpen={props.projects.menuOpen}
      canDefaultServer={props.projects.canDefaultServer}
      isDefaultServer={props.projects.isDefaultServer}
      canRevealProject={props.projects.canRevealProject}
      fileManagerActionLabel={props.projects.fileManagerActionLabel}
      unseenCount={props.projects.unseenCount}
      serverMenuID={props.projects.serverMenuID}
      projectMenuID={props.projects.projectMenuID}
      onWheel={props.scroll.containWheel}
      onChooseProject={props.projects.chooseProject}
      onFocusServer={props.projects.focusServer}
      onToggleCollapsed={props.projects.toggleCollapsed}
      onEditServer={props.projects.openEditServer}
      onSetDefaultServer={props.projects.setDefaultServer}
      onRemoveServer={props.projects.removeServer}
      onSetMenuOpen={props.projects.setMenuOpen}
      onMoveProject={props.projects.moveProject}
      onSelectProject={props.projects.selectProject}
      onAddProjects={props.projects.addProjects}
      onOpenProjectNewSession={props.projects.openProjectNewSession}
      onEditProject={props.projects.editProject}
      onRevealProject={props.projects.revealProject}
      onClearNotifications={props.projects.clearNotifications}
      onCloseProject={props.projects.closeProject}
      onOpenSettings={props.projects.openSettings}
      onOpenHelp={props.projects.openHelp}
    />
  )
}

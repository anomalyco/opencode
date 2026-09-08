import type { SessionServices } from "@opencode/plugin/desktop/workspace"
import type { SessionModel } from "@/session/model"
import { useFile } from "@/workspaces/files/model"
import { useComments } from "@/composer/comments"
import { useComposerState } from "@/composer/persistence"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useLayout } from "@/shell/state/layout"
import { useSettings } from "@/settings/model"
import { useOptionalDesktopExtensions } from "./provider"
import { useServer } from "@/runtime/server/current"

export function createSessionServices(session: SessionModel): SessionServices {
  const file = useFile()
  const annotations = useComments()
  const draft = useComposerState()
  const location = useWorkspaceLocation()
  const layout = useLayout()
  const settings = useSettings()
  const extensions = useOptionalDesktopExtensions()
  const server = useServer()
  return {
    display: { wrapDiff: settings.general.mobileDiffWrap },
    files: {
      ...file,
      get directory() {
        return location().directory
      },
    },
    annotations,
    draft: { context: draft.context },
    view: {
      ready: layout.ready,
      desktop: session.isDesktop,
      tabs: {
        all: () => session.layout.tabs().all(),
        active: session.tabs.activeTab,
        open: (reference) => session.layout.tabs().open(reference),
        close: (reference) => session.layout.tabs().close(reference),
        canClose: (reference) =>
          extensions?.state.panels.find(
            (panel) =>
              panel.key === reference &&
              panel.session.sessionID === session.identity.sessionID() &&
              panel.session.server.id === server.key,
          )?.props.closable !== false,
        setActive: (reference) => session.layout.tabs().setActive(reference),
        preview: () => session.layout.tabs().preview(),
        previewTab: (reference) => session.layout.tabs().previewTab(reference),
      },
      panel: {
        opened: () => session.layout.view().reviewPanel.opened(),
        open: (source) => session.layout.view().reviewPanel.open(source),
        close: () => session.layout.view().reviewPanel.close(),
        toggle: () => session.layout.view().reviewPanel.toggle(),
        source: () => session.layout.view().reviewPanel.source(),
      },
      sidebar: { ...layout.fileTree, allowed: settings.visibility.fileTree },
      scroll: (key) => session.layout.view().scroll(key),
      setScroll: (key, value) => session.layout.view().setScroll(key, value),
    },
    get project() {
      const project = session.project()
      return project && { id: project.id, directory: project.worktree, name: project.name, vcs: project.vcs }
    },
  }
}

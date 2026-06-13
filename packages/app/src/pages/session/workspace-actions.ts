import type { createWorkspaceTabs } from "@/context/workspace-tabs"
import { browserTabTitle, normalizeBrowserUrl } from "@/components/tabs/browser-tab"

export type WorkspaceActionRequest =
  | { type: "openFile"; path: string; title?: string; activate?: boolean }
  | { type: "openBrowser"; url: string; title?: string; activate?: boolean }
  | { type: "openTerminal"; title?: string; activate?: boolean }

type WorkspaceTabs = Pick<ReturnType<typeof createWorkspaceTabs>, "openTab">

function displayTitle(value: string | undefined) {
  const title = value?.trim()
  return title || undefined
}

function fileTitle(path: string) {
  return path.split(/[\\/]/).pop() || path
}

export function openWorkspaceAction(workspace: WorkspaceTabs, action: WorkspaceActionRequest) {
  if (action.type === "openFile") {
    const path = action.path.trim()
    if (!path) return
    return workspace.openTab("file", {
      title: displayTitle(action.title) ?? fileTitle(path),
      state: { path },
      activate: action.activate !== false,
    })
  }
  if (action.type === "openBrowser") {
    const url = normalizeBrowserUrl(action.url)
    if (!url) return
    return workspace.openTab("browser", {
      title: displayTitle(action.title) ?? browserTabTitle(url),
      state: { url },
      activate: action.activate !== false,
    })
  }
  return workspace.openTab("terminal", {
    title: displayTitle(action.title) ?? "Terminal",
    activate: action.activate !== false,
  })
}

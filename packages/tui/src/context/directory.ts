import { createMemo } from "solid-js"
import { useProject } from "./project"
import { useSync } from "./sync"
import { abbreviateHome } from "../runtime"
import { useTuiPaths } from "./runtime"

export function useDirectory() {
  const project = useProject()
  const sync = useSync()
  const paths = useTuiPaths()
  return createMemo(() => {
    const directory = project.instance.path().directory || paths.cwd

    const workspaceID = project.workspace.current()
    const workspace = workspaceID
      ? project.workspace.list().find((w) => w.id === workspaceID)
      : undefined

    const base = workspace
      ? workspace.name
      : abbreviateHome(project.data.project.mainDir || directory, paths.home)

    if (sync.data.vcs?.branch) return base + ":" + sync.data.vcs.branch
    return base
  })
}

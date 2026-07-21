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
    const result = abbreviateHome(directory, paths.home)
    if (sync.data.vcs?.branch) return result + ":" + sync.data.vcs.branch
    return result
  })
}

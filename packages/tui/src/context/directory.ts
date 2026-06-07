import { createMemo } from "solid-js"
import { useProject } from "./project"
import { useSync } from "./sync"
import { abbreviateHome, useTuiEnvironment } from "../runtime"

export function useDirectory() {
  const project = useProject()
  const sync = useSync()
  const environment = useTuiEnvironment()
  return createMemo(() => {
    const directory = project.instance.path().directory || environment.cwd
    const result = abbreviateHome(directory, environment.paths.home)
    if (sync.data.vcs?.branch) return result + ":" + sync.data.vcs.branch
    return result
  })
}

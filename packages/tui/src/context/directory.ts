import { createMemo } from "solid-js"
import { useProject } from "./project"
import { useSync } from "./sync"
import { abbreviateHome } from "../runtime"
import { useTuiPaths } from "./runtime"
import { useRoute } from "./route"

export function resolveDisplayDirectory(input: {
  sessionDirectory?: string
  instanceDirectory?: string
  cwd: string
  home: string
  branch?: string
}) {
  const directory = input.sessionDirectory || input.instanceDirectory || input.cwd
  const result = abbreviateHome(directory, input.home)
  if (input.branch) return result + ":" + input.branch
  return result
}

export function useDirectory() {
  const project = useProject()
  const sync = useSync()
  const paths = useTuiPaths()
  const route = useRoute()
  return createMemo(() => {
    const session = route.data.type === "session" ? sync.session.get(route.data.sessionID) : undefined
    return resolveDisplayDirectory({
      sessionDirectory: session?.directory,
      instanceDirectory: project.instance.path().directory,
      cwd: paths.cwd,
      home: paths.home,
      branch: sync.data.vcs?.branch,
    })
  })
}

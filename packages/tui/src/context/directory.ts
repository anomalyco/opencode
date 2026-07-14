import { createMemo } from "solid-js"
import { useProject } from "./project"
import { abbreviateHome } from "../runtime"
import { useTuiPaths } from "./runtime"

export function useDirectory() {
  const project = useProject()
  const paths = useTuiPaths()
  return createMemo(() => {
    const directory = project.instance.path().directory || paths.cwd
    return abbreviateHome(directory, paths.home)
  })
}

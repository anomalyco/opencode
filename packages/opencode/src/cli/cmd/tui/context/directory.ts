import { createMemo, createSignal } from "solid-js"
import { useSync } from "./sync"
import { Global } from "@/global"
import { createSimpleContext } from "./helper"

export function useDirectory() {
  const sync = useSync()
  return createMemo(() => {
    const directory = sync.data.path.directory || process.cwd()
    const result = directory.replace(Global.Path.home, "~")
    if (sync.data.vcs?.branch) return result + ":" + sync.data.vcs.branch
    return result
  })
}

export const { use: useProjectState, provider: ProjectProvider } = createSimpleContext({
  name: "ProjectState",
  init: (props: { project?: string; onSwitch?: (project: string) => Promise<void> }) => {
    const [current, setCurrent] = createSignal(props.project ?? process.cwd())

    const switchTo = async (project: string) => {
      if (project === current()) return true
      await props.onSwitch?.(project)
      setCurrent(project)
      return true
    }

    return {
      get current() {
        return current()
      },
      switchTo,
    }
  },
})

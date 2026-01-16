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

export const { use: useDirectoryState, provider: DirectoryProvider } = createSimpleContext({
  name: "DirectoryState",
  init: (props: { directory?: string; onSwitch?: (directory: string) => Promise<void> }) => {
    const [current, setCurrent] = createSignal(props.directory ?? process.cwd())

    const switchTo = async (directory: string) => {
      if (directory === current()) return true
      await props.onSwitch?.(directory)
      setCurrent(directory)
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

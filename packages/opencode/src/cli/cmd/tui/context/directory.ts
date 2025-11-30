import { createMemo } from "solid-js"
import { useSync } from "./sync"
import { Global } from "@/global"

export function useDirectory() {
  const sync = useSync()
  return createMemo(() => {
    const result = process.cwd().replace(Global.Path.home, "~")
    if (sync.data.vcs?.branch) return result + ":" + sync.data.vcs.branch
    return result
  })
}

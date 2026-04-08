import { createMemo } from "solid-js"
import { useSync } from "./sync"
import { useSDK } from "./sdk"
import { Global } from "@/global"

export function useDirectory() {
  const sync = useSync()
  const sdk = useSDK()
  return createMemo(() => {
    const directory = sync.data.path.directory || sdk.directory || process.cwd()
    const result = directory.replace(Global.Path.home, "~")
    if (sync.data.vcs?.branch) return result + ":" + sync.data.vcs.branch
    return result
  })
}

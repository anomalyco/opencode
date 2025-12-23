import { createMemo } from "solid-js"
import { useSync } from "./sync"
import { useSDK } from "./sdk"
import { Global } from "@/global"

export function useDirectory() {
  const sync = useSync()
  const sdk = useSDK()
  return createMemo(() => {
    const remote = sdk.remoteHost
    const directory = sync.data.path.directory || process.cwd()
    const cwd = remote ? sync.data.path.directory || "..." : directory.replace(Global.Path.home, "~")
    const prefix = remote ? `${remote} ` : ""
    if (sync.data.vcs?.branch) return prefix + cwd + ":" + sync.data.vcs.branch
    return prefix + cwd
  })
}

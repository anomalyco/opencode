import { createMemo } from "solid-js"
import { useSync } from "./sync"
import { Global } from "@/global"

export function useDirectoryDetails() {
  const sync = useSync()
  return createMemo(() => {
    const directory = sync.data.path.directory || process.cwd()
    const result = directory.replace(Global.Path.home, "~")
    const branch = sync.data.vcs?.branch
    const parts = result.split("/")
    const lastPart = parts.pop()
    const parentPath = parts.length === 0 ? "" : `${parts.join("/")}/`
    return { directory: result, parentPath, name: branch ? lastPart : `${lastPart}:${branch}` }
  })
}

export function useDirectory() {
  const dir = useDirectoryDetails()
  return createMemo(() => {
    const { parentPath, name } = dir()
    return `${parentPath}${name}`
  })
}

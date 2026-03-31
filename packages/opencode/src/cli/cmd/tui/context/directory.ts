import { createMemo } from "solid-js"
import { Global } from "@/global"
import { useSync } from "./sync"

export function useDirectory() {
  const sync = useSync()
  return createMemo(() => {
    const directory = sync.data.path.directory || process.cwd()
    const result = directory.replace(Global.Path.home, "~")
    if (sync.data.vcs?.branch) {
      const dirty = sync.data.vcs.dirty ? "*" : ""
      return result + ":" + sync.data.vcs.branch + dirty
    }
    return result
  })
}

export function useDirectoryParts() {
  const sync = useSync()
  return createMemo(() => {
    const directory = sync.data.path.directory || process.cwd()
    const path = directory.replace(Global.Path.home, "~")
    const vcs = sync.data.vcs
    return {
      path,
      branch: vcs?.branch,
      dirty: vcs?.dirty ?? false,
      staged: vcs?.staged ?? 0,
      unstaged: vcs?.unstaged ?? 0,
      untracked: vcs?.untracked ?? 0,
      conflicted: vcs?.conflicted ?? 0,
    }
  })
}

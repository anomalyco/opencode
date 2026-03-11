import { base64Encode } from "@opencode-ai/util/encode"
import type { LocalProject } from "@/context/layout"

type Nav = {
  directory: string
  list: LocalProject[]
  current?: string
  close: (directory: string) => void
  go?: (href: string) => void
  navigate?: (href: string) => void
  open: (directory: string) => Promise<void> | void
}

export function closeProject(input: Nav) {
  const go = input.go ?? input.navigate
  const index = input.list.findIndex((x) => x.worktree === input.directory)
  const active = input.current === input.directory
  if (index === -1) return
  const next = input.list[index + 1]

  if (!active) {
    input.close(input.directory)
    return
  }

  if (!next) {
    input.close(input.directory)
    go?.("/")
    return
  }

  go?.(`/${base64Encode(next.worktree)}/session`)
  input.close(input.directory)
  queueMicrotask(() => {
    void input.open(next.worktree)
  })
}

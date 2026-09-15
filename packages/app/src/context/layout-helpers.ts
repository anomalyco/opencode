import type { Accessor } from "solid-js"
import { pathKey } from "@/utils/path-key"
import type { Project } from "@opencode-ai/sdk/v2"

export type LocalProject = Partial<Project> & { worktree: string; expanded: boolean }

export function enrichProject(input: {
  project: { worktree: string; expanded: boolean }
  sync: {
    data: { project: Project[] }
    child: (directory: string, options?: { bootstrap: boolean }) => [unknown, unknown]
  }
}): LocalProject {
  const [childStore] = input.sync.child(input.project.worktree, { bootstrap: false })
  const child = (childStore ?? {}) as Record<string, unknown>
  const key = pathKey(input.project.worktree)
  const byDirectory =
    input.sync.data.project.find((x) => pathKey(x.worktree) === key) ??
    input.sync.data.project.find((x) => x.sandboxes?.some((sandbox) => pathKey(sandbox) === key))
  if (byDirectory) {
    const base = { ...byDirectory, ...input.project }
    const icon = child.icon as string | undefined
    if (icon) {
      return { ...base, icon: { ...base.icon, override: icon } }
    }
    return base
  }
  const projectID = child.project as string | undefined
  const metadata = projectID
    ? input.sync.data.project.find((x) => x.id === projectID)
    : input.sync.data.project.find((x) => pathKey(x.worktree) === key)

  // Preserve local icon override from per-workspace localStorage cache (childStore.icon).
  // Without this, different subdirectories of the same git repo would share the same
  // icon from the database instead of using their individual overrides.
  const base = { ...metadata, ...input.project }
  const icon = child.icon as string | undefined
  if (icon) {
    return { ...base, icon: { ...base.icon, override: icon } }
  }
  return base
}

export function ensureSessionKey(key: string, touch: (key: string) => void, seed: (key: string) => void) {
  touch(key)
  seed(key)
  return key
}

export function createSessionKeyReader(sessionKey: string | Accessor<string>, ensure: (key: string) => void) {
  const key = typeof sessionKey === "function" ? sessionKey : () => sessionKey
  return () => {
    const value = key()
    ensure(value)
    return value
  }
}

export function pruneSessionKeys(input: {
  keep?: string
  max: number
  used: Map<string, number>
  view: string[]
  tabs: string[]
}) {
  if (!input.keep) return []

  const keys = new Set<string>([...input.view, ...input.tabs])
  if (keys.size <= input.max) return []

  const score = (key: string) => {
    if (key === input.keep) return Number.MAX_SAFE_INTEGER
    return input.used.get(key) ?? 0
  }

  return Array.from(keys)
    .sort((a, b) => score(b) - score(a))
    .slice(input.max)
}

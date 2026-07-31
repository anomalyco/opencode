import { createMemo, createSignal } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"

const workspaceBarEnabled = import.meta.env.VITE_OPENCODE_CHANNEL !== "prod"

export function resolveNewSessionWorktree(input: {
  enabled: boolean
  selected?: string
  directory: string
  projectWorktree?: string
}) {
  if (!input.enabled) return "main"
  if (input.selected) return input.selected
  if (input.projectWorktree && input.directory !== input.projectWorktree) return input.directory
  return "main"
}

export function normalizeNewSessionWorktree(value: string, directory: string, projectWorktree?: string) {
  if (value === "main" && projectWorktree !== directory) return projectWorktree
  return value
}

export function resolveNewSessionBranch(input: {
  worktree: string
  base?: string
  local?: string
  fallback?: string
  worktreeBranch: (worktree: string) => string | undefined
}) {
  if (input.worktree === "create") return input.base ?? input.fallback ?? input.local
  if (input.worktree === "main") return input.local
  return input.worktreeBranch(input.worktree) ?? input.local
}

export function resolveNewSessionBranchTarget(input: { worktree: string; projectRoot: string }) {
  if (input.worktree === "create") return undefined
  if (input.worktree === "main") return input.projectRoot
  return input.worktree
}

export function createNewSessionWorkspaceController() {
  const sdk = useSDK()
  const sync = useSync()
  const serverSync = useServerSync()
  const [worktree, setWorktree] = createSignal<string>()
  const [base, setBase] = createSignal<string>()
  const visible = createMemo(() => workspaceBarEnabled && sync().project?.vcs === "git")
  const value = createMemo(() =>
    resolveNewSessionWorktree({
      enabled: visible(),
      selected: worktree(),
      directory: sdk().directory,
      projectWorktree: sync().project?.worktree,
    }),
  )
  const projectRoot = createMemo(() => sync().project?.worktree ?? sdk().directory)
  const localBranch = createMemo(() => serverSync().child(projectRoot())[0].vcs?.branch)
  const defaultRef = createMemo(() => {
    const vcs = serverSync().child(projectRoot())[0].vcs
    return vcs?.default_ref ?? vcs?.default_branch
  })
  const branch = createMemo(() =>
    resolveNewSessionBranch({
      worktree: value(),
      base: base(),
      local: localBranch(),
      fallback: defaultRef(),
      worktreeBranch: (worktree) => serverSync().child(worktree)[0].vcs?.branch,
    }),
  )

  return {
    selection: {
      value,
      reset: () => {
        setWorktree()
        setBase()
      },
      set: (worktree: string) => {
        const next = normalizeNewSessionWorktree(worktree, sdk().directory, sync().project?.worktree)
        if (next !== value()) setBase()
        setWorktree(next)
      },
    },
    project: {
      root: projectRoot,
      workspaces: () => sync().project?.sandboxes ?? [],
      git: () => sync().project?.vcs === "git",
    },
    bar: {
      visible,
      branch,
      base,
      setBase,
      target: () => resolveNewSessionBranchTarget({ worktree: value(), projectRoot: projectRoot() }),
    },
  }
}

export type NewSessionWorkspaceController = ReturnType<typeof createNewSessionWorkspaceController>

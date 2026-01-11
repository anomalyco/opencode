import { Show, createMemo } from "solid-js"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { Icon } from "@opencode-ai/ui/icon"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { Select } from "@opencode-ai/ui/select"

export const MAIN_WORKTREE = "main"
export const CREATE_WORKTREE = "create"
export const BRANCH_PREFIX = "branch:"

interface NewSessionViewProps {
  worktree: string
  onWorktreeChange: (value: string) => void
}

export function NewSessionView(props: NewSessionViewProps) {
  const sync = useSync()

  const sandboxes = createMemo(() => sync.project?.sandboxes ?? [])
  const currentBranch = createMemo(() => sync.data?.vcs?.branch)

  // Get recent branches excluding the current one
  const recentBranches = createMemo(() => {
    const branches = sync.data?.branches
    if (!Array.isArray(branches)) return []
    const current = currentBranch()
    return branches.filter((b) => !b.current && b.name !== current).slice(0, 6)
  })

  const options = createMemo(() => {
    const branches = recentBranches()
    const branchOptions = branches.map((b) => `${BRANCH_PREFIX}${b.name}`)
    const sboxes = sandboxes()
    return [MAIN_WORKTREE, ...branchOptions, ...sboxes, CREATE_WORKTREE]
  })

  const current = createMemo(() => {
    const selection = props.worktree
    if (options().includes(selection)) return selection
    return MAIN_WORKTREE
  })
  const projectRoot = createMemo(() => sync.project?.worktree ?? sync.data?.path?.directory ?? "")
  const isWorktree = createMemo(() => {
    const project = sync.project
    if (!project) return false
    return sync.data?.path?.directory !== project.worktree
  })

  const label = (value: string) => {
    if (value === MAIN_WORKTREE) {
      if (isWorktree()) return "Main branch"
      const branch = currentBranch()
      if (branch) return `Current branch (${branch})`
      return "Current branch"
    }

    if (value.startsWith(BRANCH_PREFIX)) {
      return value.slice(BRANCH_PREFIX.length)
    }

    if (value === CREATE_WORKTREE) return "Create new worktree"

    return getFilename(value)
  }

  return (
    <div
      class="size-full flex flex-col pb-45 justify-end items-start gap-4 flex-[1_0_0] self-stretch max-w-200 mx-auto px-6"
      style={{ "padding-bottom": "calc(var(--prompt-height, 11.25rem) + 64px)" }}
    >
      <div class="text-20-medium text-text-weaker">New session</div>
      <div class="flex justify-center items-center gap-3">
        <Icon name="folder" size="small" />
        <div class="text-12-medium text-text-weak">
          {getDirectory(projectRoot())}
          <span class="text-text-strong">{getFilename(projectRoot())}</span>
        </div>
      </div>
      <div class="flex justify-center items-center gap-1">
        <Icon name="branch" size="small" />
        <Select
          options={options()}
          current={current()}
          value={(x) => x}
          label={label}
          onSelect={(value) => {
            props.onWorktreeChange(value ?? MAIN_WORKTREE)
          }}
          size="normal"
          variant="ghost"
          class="text-12-medium"
        />
      </div>
      <Show when={sync.project}>
        {(project) => (
          <div class="flex justify-center items-center gap-3">
            <Icon name="pencil-line" size="small" />
            <div class="text-12-medium text-text-weak">
              Last modified&nbsp;
              <span class="text-text-strong">
                {DateTime.fromMillis(project().time.updated ?? project().time.created).toRelative()}
              </span>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

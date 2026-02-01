import { Show, createMemo } from "solid-js"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { Icon } from "@opencode-ai/ui/icon"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { Select } from "@opencode-ai/ui/select"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLayout } from "@/context/layout"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/util/encode"
import { RepoSelector } from "@/components/repo/repo-selector"
import { RepositoryManagerDialog } from "@/components/repo/repository-manager-dialog"
import { useServer } from "@/context/server"
import type { Repo } from "@opencode-ai/sdk/v2/client"

const MAIN_WORKTREE = "main"
const CREATE_WORKTREE = "create"

interface NewSessionViewProps {
  worktree: string
  onWorktreeChange: (value: string) => void
}

export function NewSessionView(props: NewSessionViewProps) {
  const sync = useSync()
  const layout = useLayout()
  const dialog = useDialog()
  const server = useServer()
  const navigate = useNavigate()

  const sandboxes = createMemo(() => sync.project?.sandboxes ?? [])
  const options = createMemo(() => [MAIN_WORKTREE, ...sandboxes(), CREATE_WORKTREE])
  const current = createMemo(() => {
    const selection = props.worktree
    if (options().includes(selection)) return selection
    return MAIN_WORKTREE
  })
  const projectRoot = createMemo(() => sync.project?.worktree ?? sync.data.path.directory)
  const isWorktree = createMemo(() => {
    const project = sync.project
    if (!project) return false
    return sync.data.path.directory !== project.worktree
  })

  const currentRepoPath = createMemo(() => sync.project?.worktree)
  const showManageHint = createMemo(() => !currentRepoPath())

  const openRepo = (repo: Repo) => {
    layout.projects.open(repo.path)
    server.projects.touch(repo.path)
    navigate(`/${base64Encode(repo.path)}/session`)
  }

  const openRepoManager = () => {
    dialog.show(() => <RepositoryManagerDialog onOpenRepo={openRepo} />)
  }

  const label = (value: string) => {
    if (value === MAIN_WORKTREE) {
      if (isWorktree()) return "Main branch"
      const branch = sync.data.vcs?.branch
      if (branch) return `Main branch (${branch})`
      return "Main branch"
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
      <RepoSelector currentPath={currentRepoPath()} onOpenRepo={openRepo} />
      <div class="flex items-center gap-2">
        <Button size="normal" variant="ghost" onClick={openRepoManager}>
          <Icon name="branch" size="small" />
          Manage repos
        </Button>
      </div>
      <Show when={showManageHint()}>
        <div class="text-12-regular text-text-weak">No repositories yet. Manage repos to add or clone one.</div>
      </Show>
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

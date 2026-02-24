import { Show, createMemo } from "solid-js"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { Icon } from "@opencode-ai/ui/icon"
import { getDirectory, getFilename } from "@opencode-ai/util/path"

const MAIN_WORKTREE = "main"
const CREATE_WORKTREE = "create"
const ROOT_CLASS =
  "size-full flex flex-col justify-center items-center gap-6 flex-[1_0_0] self-stretch max-w-200 mx-auto 2xl:max-w-[1000px] px-6 pb-24"

interface NewSessionViewProps {
  worktree: string
  onWorktreeChange: (value: string) => void
}

export function NewSessionView(props: NewSessionViewProps) {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()

  const sandboxes = createMemo(() => sync.project?.sandboxes ?? [])
  const options = createMemo(() => [MAIN_WORKTREE, ...sandboxes(), CREATE_WORKTREE])
  const current = createMemo(() => {
    const selection = props.worktree
    if (options().includes(selection)) return selection
    return MAIN_WORKTREE
  })
  const projectRoot = createMemo(() => sync.project?.worktree ?? sdk.directory)
  const isWorktree = createMemo(() => {
    const project = sync.project
    if (!project) return false
    return sdk.directory !== project.worktree
  })

  const label = (value: string) => {
    if (value === MAIN_WORKTREE) {
      if (isWorktree()) return language.t("session.new.worktree.main")
      const branch = sync.data.vcs?.branch
      if (branch) return language.t("session.new.worktree.mainWithBranch", { branch })
      return language.t("session.new.worktree.main")
    }

    if (value === CREATE_WORKTREE) return language.t("session.new.worktree.create")

    return getFilename(value)
  }

  return (
    <div class={ROOT_CLASS}>
      {/* Greeting — large, centered, with subtle fade-in */}
      <div
        class="text-20-medium text-text-weaker opacity-0"
        style="animation: fadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards"
      >
        {language.t("command.session.new")}
      </div>

      {/* Project info badges — compact, pill-shaped, staggered entrance */}
      <div class="flex flex-col items-center gap-2">
        <div
          class="flex items-center gap-2 px-3 py-1.5 rounded-full opacity-0"
          style="background: var(--surface-base); border: 1px solid var(--border-weaker-base); animation: fadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s forwards"
        >
          <Icon name="folder" size="small" />
          <div class="text-12-medium text-text-weak select-text">
            {getDirectory(projectRoot())}
            <span class="text-text-strong">{getFilename(projectRoot())}</span>
          </div>
        </div>

        <div
          class="flex items-center gap-2 px-3 py-1.5 rounded-full opacity-0"
          style="background: var(--surface-base); border: 1px solid var(--border-weaker-base); animation: fadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s forwards"
        >
          <Icon name="branch" size="small" />
          <div class="text-12-medium text-text-weak select-text">{label(current())}</div>
        </div>

        <Show when={sync.project}>
          {(project) => (
            <div
              class="flex items-center gap-2 px-3 py-1.5 rounded-full opacity-0"
              style="background: var(--surface-base); border: 1px solid var(--border-weaker-base); animation: fadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.4s forwards"
            >
              <Icon name="pencil-line" size="small" />
              <div class="text-12-medium text-text-weak">
                {language.t("session.new.lastModified")}&nbsp;
                <span class="text-text-strong">
                  {DateTime.fromMillis(project().time.updated ?? project().time.created)
                    .setLocale(language.locale())
                    .toRelative()}
                </span>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

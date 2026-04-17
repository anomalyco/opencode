import { Show, createMemo } from "solid-js"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { Icon } from "@opencode-ai/ui/icon"
import { Mark } from "@opencode-ai/ui/logo"
import { Select } from "@opencode-ai/ui/select"
import { getFilename } from "@opencode-ai/util/path"
import { workspaceKey } from "@/pages/layout/helpers"
import { extraAgentByDirectory } from "@/pages/layout/extra-agents"

const MAIN_WORKTREE = "main"
const ROOT_CLASS = "size-full flex flex-col"
const GREETINGS = [
  "session.new.greeting.1",
  "session.new.greeting.2",
  "session.new.greeting.3",
  "session.new.greeting.4",
] as const

interface NewSessionViewProps {
  worktree: string
  onWorktreeChange: (value: string) => void
}

export function NewSessionView(props: NewSessionViewProps) {
  const sync = useSync()
  const sdk = useSDK()
  const language = useLanguage()
  const git = createMemo(() => sync.project?.vcs === "git")
  const root = createMemo(() => {
    const directory = sync.data.path.directory || sdk.directory
    if (!git()) return directory || sync.data.path.worktree || sync.project?.worktree || sdk.directory
    return sync.project?.worktree || sync.data.path.worktree || directory || sdk.directory
  })

  const listed = createMemo(() => {
    if (!git()) return []
    const items = sync.data.vcs?.worktrees ?? []
    const fallback = root()
    if (items.some((item) => workspaceKey(item.path) === workspaceKey(fallback))) return items
    return [{ path: fallback, branch: sync.data.vcs?.branch }, ...items]
  })
  const worktrees = createMemo(() => {
    const project = sync.project
    if (!git() || !project) return []
    const main = listed().find((item) => workspaceKey(item.path) === workspaceKey(project?.worktree || ""))
    const base = listed()
      .filter((item, index, list) => list.findIndex((x) => workspaceKey(x.path) === workspaceKey(item.path)) === index)
      .toSorted((a, b) => {
        if (workspaceKey(a.path) === workspaceKey(root())) return -1
        if (workspaceKey(b.path) === workspaceKey(root())) return 1
        return a.path.localeCompare(b.path)
      })
    return [
      { value: MAIN_WORKTREE, path: project.worktree, branch: main?.branch },
      ...base
        .filter((item) => workspaceKey(item.path) !== workspaceKey(project.worktree))
        .map((item) => ({ value: item.path, path: item.path, branch: item.branch })),
    ]
  })
  const current = createMemo(() => {
    const selection = props.worktree
    return worktrees().find((item) => item.value === selection) ?? worktrees()[0]
  })
  const name = createMemo(() => sync.project?.name || getFilename(root()) || root())
  const extraAgent = createMemo(() => extraAgentByDirectory(root()))
  const branch = createMemo(() => current()?.branch || language.t("session.new.meta.unknown"))
  const next = createMemo(() => {
    if (current()?.value === MAIN_WORKTREE) return root()
    return current()?.path || root()
  })
  const picked = createMemo(() => current()?.value !== MAIN_WORKTREE)
  const greet = createMemo(() => {
    const agent = extraAgent()
    if (agent?.emptySessionTitleKey) return language.t(agent.emptySessionTitleKey)
    const seed = [...root()].reduce((sum, item) => sum + item.charCodeAt(0), 0)
    return language.t(GREETINGS[seed % GREETINGS.length])
  })

  return (
    <div class={ROOT_CLASS}>
      <div class="h-12 shrink-0" aria-hidden />
      <div class="flex-1 px-6 pb-30 flex items-center justify-center text-center">
        <div class="w-full max-w-200 flex flex-col items-center text-center gap-6">
          <div class="flex flex-col items-center gap-6">
            <Show when={extraAgent()?.emptyIcon} fallback={<Mark class="w-10" />}>
              {(icon) => <Icon name={icon()} size="x-large" />}
            </Show>
            <div class="text-20-medium text-text-strong">
              {greet()}
            </div>
          </div>
          <div class="w-full max-w-180 px-5 py-2">
            <div class="text-20-medium text-text-strong select-text break-words">{name()}</div>
            <div class="mt-1 break-all text-12-medium text-text-weak select-text">{root()}</div>
            <Show when={!extraAgent() && git()}>
              <div class="mt-5 grid gap-3 text-left">
                <div class="rounded-xl border border-border-weak-base bg-background-base/45 px-4 py-3 shadow-xs-border-base">
                  <div class="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-text-weaker">
                    <Icon name="branch" size="small" class="shrink-0 text-icon-base" />
                    <span>{language.t("session.new.meta.branch")}</span>
                  </div>
                  <div class="mt-1 break-all text-14-medium text-text-strong select-text">{branch()}</div>
                </div>
                <div class="rounded-xl border border-border-weak-base bg-background-base/45 px-4 py-3 shadow-xs-border-base">
                  <div class="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-text-weaker">
                    <Icon name="folder" size="small" class="shrink-0 text-icon-base" />
                    <span>{language.t("session.new.meta.workspace")}</span>
                  </div>
                  <div class="mt-2">
                    <Select
                      options={worktrees()}
                      current={current()}
                      value={(item) => item.value}
                      label={(item) => getFilename(item.path) || item.path}
                      onSelect={(item) => item && props.onWorktreeChange(item.value)}
                      variant="secondary"
                      size="normal"
                      class="w-full"
                      valueClass="truncate text-left text-14-medium text-text-strong"
                      triggerStyle={{
                        width: "100%",
                        height: "auto",
                        "min-height": "44px",
                        "line-height": "normal",
                        "justify-content": "space-between",
                        padding: "10px 4px 10px 8px",
                      }}
                      contentStyle={{ width: "var(--kb-popper-anchor-width)", "max-width": "var(--kb-popper-anchor-width)" }}
                    >
                      {(item) => {
                        if (!item) return ""
                        return (
                          <div class="min-w-0 flex flex-col text-left">
                            <div class="truncate text-14-medium text-text-strong">{getFilename(item.path) || item.path}</div>
                            <div class="truncate text-12-regular text-text-weak">{item.path}</div>
                          </div>
                        )
                      }}
                    </Select>
                  </div>
                </div>
                <Show when={picked()}>
                  <div class="rounded-xl border border-border-weak-base bg-background-base/45 px-4 py-3 shadow-xs-border-base">
                    <div class="text-[10px] uppercase tracking-[0.12em] text-text-weaker">
                      {language.t("session.new.meta.target")}
                    </div>
                    <div class="mt-1 break-all font-mono text-[13px] leading-6 text-text-strong select-text">{next()}</div>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}

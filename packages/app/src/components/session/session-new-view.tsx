import { For, Show, createEffect, createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Mark } from "@opencode-ai/ui/logo"
import { Select } from "@opencode-ai/ui/select"
import { getFilename } from "@opencode-ai/util/path"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { workspaceKey } from "@/pages/layout/helpers"
import { extraAgentByDirectory, mainDomain } from "@/pages/layout/extra-agents"
import { sessionNewMeta, sessionNewPane } from "./session-new-view-layout"
import { hermesMeta, hermesView } from "./session-new-view-meta"

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
  const dialog = useDialog()
  const [view, setView] = createStore({
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 960 : (window.visualViewport?.height ?? window.innerHeight),
  })
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
  const genericAgentCwd = createMemo(() => {
    if (extraAgent()?.id !== "genericagent") return
    if (!props.worktree || props.worktree === MAIN_WORKTREE || props.worktree === "create") return
    return props.worktree
  })
  const greet = createMemo(() => {
    const agent = extraAgent()
    if (agent?.emptySessionTitleKey) return language.t(agent.emptySessionTitleKey)
    const seed = [...root()].reduce((sum, item) => sum + item.charCodeAt(0), 0)
    return language.t(GREETINGS[seed % GREETINGS.length])
  })
  const meta = createMemo(() => {
    if (extraAgent()?.id !== "hermes") return
    return hermesMeta(sync.data.agent)
  })
  const summary = createMemo(() => hermesView(meta(), view))
  const pane = createMemo(() => sessionNewPane(view.width))
  const agent = createMemo(() => !!extraAgent())
  const body = createMemo(() => sessionNewMeta(agent()))

  createEffect(() => {
    const info = meta()
    if (!info) return
    console.debug(
      `[session-new] hermes startup meta version=${info.version ?? "none"} upstream=${info.upstream ?? "none"} total=${info.total} rows=${info.rows.length}`,
    )
  })

  createEffect(() => {
    if (typeof window === "undefined") return

    const sync = () =>
      setView({
        width: window.innerWidth,
        height: window.visualViewport?.height ?? window.innerHeight,
      })

    const port = window.visualViewport
    sync()
    window.addEventListener("resize", sync)
    port?.addEventListener("resize", sync)
    onCleanup(() => {
      window.removeEventListener("resize", sync)
      port?.removeEventListener("resize", sync)
    })
  })

  createEffect(() => {
    const info = summary()
    if (!info) return
    console.debug(
      `[session-new] hermes startup summary width=${view.width} height=${view.height} pane=${pane()} cols=${info.cols} shown=${info.shown} total=${info.total} moreRows=${info.moreRows} moreTools=${info.moreTools}`,
    )
  })

  createEffect(() => {
    console.debug(`[session-new] layout agent=${extraAgent()?.id ?? "none"} pane=${pane()} body=${body() || "none"}`)
  })

  const chooseGenericAgentCwd = () => {
    dialog.show(() => (
      <DialogSelectDirectory
        title={language.t("session.new.genericagent.cwd.choose")}
        domain={mainDomain}
        onSelect={(value) => {
          if (typeof value !== "string") return
          props.onWorktreeChange(value)
        }}
      />
    ))
  }

  return (
    <div class={ROOT_CLASS}>
      <div class="h-12 shrink-0" aria-hidden />
      <div class="flex-1 px-6 pb-30 flex items-center justify-center text-center">
        <div class="w-full flex flex-col items-center text-center gap-6" style={{ "max-width": pane() }}>
          <div class="flex flex-col items-center gap-6">
            <Show when={extraAgent()?.emptyIcon} fallback={<Mark class="w-10" />}>
              {(icon) => <Icon name={icon()} size="x-large" />}
            </Show>
            <div class="text-20-medium text-text-strong">
              {greet()}
            </div>
          </div>
          <div class={`w-full px-3 py-2 sm:px-5 ${body()}`.trim()}>
            <div class="text-20-medium text-text-strong select-text break-words">{name()}</div>
            <div class="mt-1 break-all text-12-medium text-text-weak select-text">{root()}</div>
            <Show when={meta()}>
              {(metaInfo) => (
                <div class="mt-5 grid gap-3 text-left">
                  <div class="rounded-[20px] border border-border-warning-base bg-surface-warning-weak/75 px-4 py-3 shadow-xs-border-base">
                    <div class="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-icon-warning-base">
                      <Icon name="hermes" size="small" class="shrink-0 text-icon-warning-base" />
                      <span>{language.t("session.new.hermes.runtime")}</span>
                    </div>
                    <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-15-medium text-text-strong">
                      <span>Hermes Agent</span>
                      <Show when={metaInfo().version}>{(item) => <span class="text-icon-warning-base">v{item()}</span>}</Show>
                      <Show when={metaInfo().upstream}>
                        {(item) => (
                          <span class="text-12-regular text-text-weak">
                            {language.t("session.new.hermes.upstream", { sha: item() })}
                          </span>
                        )}
                      </Show>
                    </div>
                    <Show when={metaInfo().total > 0}>
                      <div class="mt-1 text-12-regular text-text-weak">
                        {language.t("session.new.hermes.totalTools", { count: metaInfo().total })}
                      </div>
                    </Show>
                  </div>

                  <Show when={summary()}>
                    {(info) => (
                      <Show when={info().rows.length > 0}>
                        <div class="rounded-[20px] border border-border-warning-base/70 bg-background-base/55 px-4 py-4 shadow-xs-border-base">
                          <div class="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-icon-warning-base">
                            <Icon name="bullet-list" size="small" class="shrink-0 text-icon-warning-base" />
                            <span>{language.t("session.new.hermes.availableTools")}</span>
                          </div>
                          <div class="mt-2 text-12-regular text-text-weak">
                            {language.t("session.new.hermes.showingToolsets", {
                              shown: info().shown,
                              total: info().total,
                            })}
                          </div>
                          <div
                            class="mt-3 grid gap-x-6 gap-y-2.5"
                            classList={{
                              "grid-cols-2": info().cols === 2,
                            }}
                          >
                            <For each={info().rows}>
                              {(row) => (
                                <div class="grid gap-2 md:grid-cols-[120px_minmax(0,1fr)] md:items-start">
                                  <div class="flex items-center">
                                    <span class="rounded-full bg-surface-warning-base px-2 py-0.5 font-mono text-11-medium text-icon-warning-active">
                                      {row.id}
                                    </span>
                                  </div>
                                  <div class="flex flex-wrap gap-1.5">
                                    <For each={row.tools}>
                                      {(tool) => (
                                        <code class="rounded-md border border-border-weak-base bg-background-base/70 px-2 py-1 text-[12px] leading-4 text-text-strong">
                                          {tool}
                                        </code>
                                      )}
                                    </For>
                                    <Show when={row.extra > 0}>
                                      <span class="rounded-md border border-border-warning-base bg-surface-warning-weak px-2 py-1 text-12-medium text-icon-warning-active">
                                        +{row.extra}
                                      </span>
                                    </Show>
                                  </div>
                                </div>
                              )}
                            </For>
                          </div>
                          <Show when={info().moreRows > 0 || info().moreTools > 0}>
                            <div class="mt-3 text-12-regular text-text-weak">
                              {language.t("session.new.hermes.trimmed", {
                                rows: info().moreRows,
                                tools: info().moreTools,
                              })}
                            </div>
                          </Show>
                        </div>
                      </Show>
                    )}
                  </Show>
                </div>
              )}
            </Show>
            <Show when={extraAgent()?.id === "genericagent"}>
              <div class="mt-5 grid gap-3 text-left">
                <div class="rounded-xl border border-border-weak-base bg-background-base/45 px-4 py-3 shadow-xs-border-base">
                  <div class="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-text-weaker">
                    <Icon name="folder" size="small" class="shrink-0 text-icon-base" />
                    <span>{language.t("session.new.genericagent.cwd.label")}</span>
                  </div>
                  <div class="mt-2 break-all font-mono text-[13px] leading-6 text-text-strong select-text">
                    {genericAgentCwd() ?? language.t("session.new.genericagent.cwd.default")}
                  </div>
                  <div class="mt-3 flex justify-start">
                    <Button size="small" variant="secondary" icon="folder-add-left" onClick={chooseGenericAgentCwd}>
                      {language.t("session.new.genericagent.cwd.choose")}
                    </Button>
                  </div>
                </div>
              </div>
            </Show>
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

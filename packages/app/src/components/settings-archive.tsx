import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { RadioGroup } from "@opencode-ai/ui/radio-group"
import { getFilename } from "@opencode-ai/util/path"
import { Component, For, Show, createMemo, createResource, createSignal } from "solid-js"
import { useParams } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { getRelativeTime } from "@/utils/time"
import { decode64 } from "@/utils/base64"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { SessionSkeleton } from "@/pages/layout/sidebar-items"

type FilterScope = "all" | "current"

type ScopeOption = { value: FilterScope; label: "settings.archive.scope.all" | "settings.archive.scope.current" }

const scopeOptions: ScopeOption[] = [
  { value: "all", label: "settings.archive.scope.all" },
  { value: "current", label: "settings.archive.scope.current" },
]

export const SettingsArchive: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const layout = useLayout()
  const params = useParams()
  const [removedIds, setRemovedIds] = createSignal<Set<string>>(new Set())

  const projects = createMemo(() => globalSync.data.project)
  const layoutProjects = createMemo(() => layout.projects.list())
  const hasMultipleProjects = createMemo(() => projects().length > 1)
  const homedir = createMemo(() => globalSync.data.path.home)

  const defaultScope = () => (hasMultipleProjects() ? "current" : "all")
  const [filterScope, setFilterScope] = createSignal<FilterScope>(defaultScope())

  const currentDirectory = createMemo(() => decode64(params.dir) ?? "")

  const currentProject = createMemo(() => {
    const dir = currentDirectory()
    if (!dir) return null
    return layoutProjects().find((p) => p.worktree === dir || p.sandboxes?.includes(dir)) ?? null
  })

  const filteredProjects = createMemo(() => {
    if (filterScope() === "current" && currentProject()) {
      return [currentProject()!]
    }
    return layoutProjects()
  })

  const getSessionLabel = (session: Session) => {
    const directory = session.directory
    const home = homedir()
    const path = home ? directory.replace(home, "~") : directory

    if (filterScope() === "current" && currentProject()) {
      const current = currentProject()
      const kind =
        current && directory === current.worktree
          ? language.t("workspace.type.local")
          : language.t("workspace.type.sandbox")
      const [store] = globalSync.child(directory, { bootstrap: false })
      const name = store.vcs?.branch ?? getFilename(directory)
      return `${kind} : ${name || path}`
    }

    return path
  }

  const [archivedSessions] = createResource(
    () => ({ scope: filterScope(), projects: filteredProjects() }),
    async ({ projects }) => {
      const allSessions: Session[] = []
      for (const project of projects) {
        const directories = [project.worktree, ...(project.sandboxes ?? [])]
        for (const directory of directories) {
          const result = await globalSDK.client.experimental.session.list({ directory, archived: true })
          const sessions = result.data ?? []
          for (const session of sessions) {
            allSessions.push(session)
          }
        }
      }
      return allSessions.sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
    },
    { initialValue: [] },
  )

  const displayedSessions = () => {
    const sessions = archivedSessions() ?? []
    const removed = removedIds()
    return sessions.filter((s) => !removed.has(s.id))
  }

  const currentScopeOption = () => scopeOptions.find((o) => o.value === filterScope())

  const unarchiveSession = async (session: Session) => {
    setRemovedIds((prev) => new Set(prev).add(session.id))
    await globalSDK.client.session.update({
      directory: session.directory,
      sessionID: session.id,
      time: { archived: null as any },
    })
  }

  const handleScopeChange = (option: ScopeOption | undefined) => {
    if (!option) return
    setRemovedIds(new Set<string>())
    setFilterScope(option.value)
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.archive.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.archive.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-4 max-w-[720px]">
        <Show when={hasMultipleProjects()}>
          <RadioGroup
            options={scopeOptions}
            current={currentScopeOption() ?? undefined}
            value={(o) => o.value}
            size="small"
            label={(o) => language.t(o.label)}
            onSelect={handleScopeChange}
          />
        </Show>
        <Show
          when={!archivedSessions.loading}
          fallback={
            <div class="min-h-[700px]">
              <SessionSkeleton count={4} />
            </div>
          }
        >
          <Show
            when={displayedSessions().length}
            fallback={
              <div class="min-h-[700px]">
                <div class="text-14-regular text-text-weak">{language.t("settings.archive.none")}</div>
              </div>
            }
          >
            <div class="min-h-[700px] flex flex-col gap-2">
              <For each={displayedSessions()}>
                {(session) => (
                  <div class="flex items-center justify-between gap-4 px-3 py-1 rounded-md hover:bg-surface-raised-base-hover">
                    <div class="flex items-center gap-x-3 grow min-w-0">
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="text-14-regular text-text-strong truncate">{session.title}</span>
                        <span class="text-14-regular text-text-weak truncate">{getSessionLabel(session)}</span>
                      </div>
                    </div>
                    <div class="flex items-center gap-4 shrink-0">
                      <Show when={session.time?.updated}>
                        {(updated) => (
                          <span class="text-12-regular text-text-weak whitespace-nowrap">
                            {getRelativeTime(new Date(updated()).toISOString(), language.t)}
                          </span>
                        )}
                      </Show>
                      <Button
                        size="normal"
                        variant="secondary"
                        onClick={() => unarchiveSession(session)}
                      >
                        {language.t("common.unarchive")}
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
}

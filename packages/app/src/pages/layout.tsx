import { Toast } from "@opencode-ai/ui/toast"
import type { Project } from "@opencode-ai/sdk/v2/client"
import { Avatar } from "@opencode-ai/ui/avatar"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { For, Show, createEffect, createMemo, type ParentProps } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Titlebar } from "@/components/titlebar"
import { DialogCreateProject } from "@/components/dialog-create-project"
import { DialogSettings } from "@/components/dialog-settings"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"

const AVATAR_COLOR_KEYS = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const

function avatarColors(key?: string) {
  if (key && AVATAR_COLOR_KEYS.includes(key as (typeof AVATAR_COLOR_KEYS)[number])) {
    return {
      background: `var(--avatar-background-${key})`,
      foreground: `var(--avatar-text-${key})`,
    }
  }
  return {
    background: "var(--surface-info-base)",
    foreground: "var(--text-base)",
  }
}

function Sidebar() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const params = useParams()
  const navigate = useNavigate()
  const dialog = useDialog()
  const platform = usePlatform()
  const current = createMemo(() => params.dir ?? "")
  const projects = createMemo(() =>
    sync.data.project.slice().sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created)),
  )
  const sessions = createMemo(() => {
    const id = current()
    if (!id) return []
    const [store] = sync.child(id, { bootstrap: false })
    return store.session
      .filter((item) => !item.parentID && !item.time?.archived)
      .slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
  })

  createEffect(() => {
    const id = current()
    if (!id) return
    void sync.project.loadSessions(id)
  })

  const openProject = (id: string) => navigate(`/${id}/session`)
  const openSession = (id: string) => navigate(`/${current()}/session/${id}`)
  const rememberProject = (project: Project) => {
    const next = sync.data.project.slice()
    const index = next.findIndex((item) => item.id === project.id)
    if (index >= 0) next[index] = project
    else next.unshift(project)
    sync.set("project", next)
  }
  const createProject = () =>
    dialog.show(() => (
      <DialogCreateProject
        onCreate={(project) => {
          rememberProject(project)
          openProject(project.id)
        }}
      />
    ))
  const startNewSession = () => {
    const dir = current()
    if (!dir) return

    if (params.id) {
      const source = layout.tabs(`${dir}/${params.id}`).tabs()
      if (source.all.length > 0 || source.active) {
        const target = layout.tabs(dir)
        target.setAll(source.all)
        target.setActive(source.active && source.all.includes(source.active) ? source.active : source.all[0])
      }
    }

    navigate(`/${dir}/session`)
  }

  return (
    <aside class="shrink-0 bg-background-base flex h-full min-h-0 overflow-hidden">
      <div
        data-component="sidebar-rail"
        class="w-16 shrink-0 bg-background-base flex flex-col items-center overflow-hidden"
      >
        <div class="flex-1 min-h-0 w-full">
          <div class="h-full w-full flex flex-col items-center gap-4 px-4 py-4 overflow-y-auto no-scrollbar">
            <For each={projects()}>
              {(project) => (
                <button
                  type="button"
                  aria-label={project.name || project.id}
                  aria-current={project.id === current() ? "page" : undefined}
                  data-action="project-switch"
                  data-project={project.id}
                  class="flex items-center justify-center size-12 p-1 rounded-lg overflow-hidden transition-all duration-200 ease-out cursor-default hover:scale-105 active:scale-95"
                  classList={{
                    "bg-transparent border-2 border-icon-strong-base hover:bg-surface-base-hover":
                      project.id === current(),
                    "bg-transparent border border-transparent hover:bg-surface-base-hover hover:border-border-weak-base":
                      project.id !== current(),
                  }}
                  onClick={() => openProject(project.id)}
                >
                  <Avatar
                    fallback={project.name || project.id}
                    src={project.icon?.override}
                    {...avatarColors(project.icon?.color)}
                    class="size-full rounded"
                  />
                </button>
              )}
            </For>
            <IconButton icon="plus" variant="ghost" size="large" onClick={createProject} aria-label="New project" />
          </div>
        </div>
        <div class="shrink-0 w-full pt-3 pb-6 flex flex-col items-center gap-2">
          <IconButton
            icon="settings-gear"
            variant="ghost"
            size="large"
            onClick={() => dialog.show(() => <DialogSettings />)}
            aria-label="Settings"
          />
          <IconButton
            icon="help"
            variant="ghost"
            size="large"
            onClick={() => platform.openLink("https://opencode.ai/desktop-feedback")}
            aria-label="Help"
          />
        </div>
      </div>

      <Show when={layout.sidebar.opened() && current()}>
        <div class="w-72 border-r border-border-weak-base flex h-full min-h-0 min-w-0 flex-col bg-background-base">
          <div class="px-6 py-5 border-b border-border-weak-base flex items-center justify-between">
            <div class="min-w-0">
              <div class="text-12-medium text-text-weak">Project</div>
              <div class="text-14-medium text-text-strong truncate">
                {projects().find((project) => project.id === current())?.name || current()}
              </div>
            </div>
            <button
              type="button"
              class="shrink-0 size-7 rounded-md flex items-center justify-center hover:bg-surface-base-hover text-icon-base"
              onClick={startNewSession}
              aria-label="New session"
            >
              <Icon name="plus-small" size="small" />
            </button>
          </div>

          <div class="px-4 pb-4 flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col gap-2">
            <div class="px-2 pt-4 pb-3 text-12-medium text-text-weak">Sessions</div>
            <For each={sessions()}>
              {(session) => (
                <button
                  type="button"
                  data-session-id={session.id}
                  class="group/session relative w-full rounded-md cursor-default transition-all duration-200 ease-out px-3 hover:bg-surface-raised-base-hover [&:has(:focus-visible)]:bg-surface-raised-base-hover hover:scale-[1.02] active:scale-[0.98]"
                  classList={{
                    "bg-surface-base-active text-text-strong": session.id === params.id,
                    "text-text-base": session.id !== params.id,
                  }}
                  onClick={() => openSession(session.id)}
                >
                  <div class="flex items-center gap-2 w-full py-2">
                    <div class="shrink-0 size-6 flex items-center justify-center">
                      <Icon name="dash" size="small" class="text-icon-weak" />
                    </div>
                    <span class="text-14-regular grow-1 min-w-0 overflow-hidden text-ellipsis truncate text-left">
                      {session.title || session.id}
                    </span>
                  </div>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </aside>
  )
}

export default function Layout(props: ParentProps) {
  return (
    <div class="relative bg-background-base flex-1 min-h-0 min-w-0 flex flex-col">
      <Titlebar />
      <div class="flex-1 min-h-0 min-w-0 flex overflow-hidden">
        <Sidebar />
        <main class="flex-1 min-h-0 min-w-0 overflow-hidden">{props.children}</main>
      </div>
      <Toast.Region />
    </div>
  )
}

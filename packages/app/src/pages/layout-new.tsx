import { A, useLocation } from "@solidjs/router"
import { Mark } from "@opencode-ai/ui/logo"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { For, Show, createEffect, createMemo, Suspense, type ParentProps } from "solid-js"
import { getFilename } from "@opencode-ai/core/util/path"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { tabHref, tabKey, useTabs } from "@/context/tabs"
import { setV2Toast, ToastRegion } from "@/utils/toast"
import "./layout-new.css"

function NewLayoutAction(props: {
  icon: string
  label: string
  keybind?: string
  popup?: "dialog"
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-component="new-layout-sidebar-action"
      class="new-layout-sidebar-action"
      aria-haspopup={props.popup}
      onClick={props.onClick}
    >
      <IconV2 name={props.icon} size="small" />
      <span class="min-w-0 flex-1 truncate text-left">{props.label}</span>
      <Show when={props.keybind}>
        <span data-component="new-layout-sidebar-shortcut">{props.keybind}</span>
      </Show>
    </button>
  )
}

function NewLayoutSection(props: ParentProps<{ title: string }>) {
  return (
    <section data-component="new-layout-sidebar-section">
      <h2 data-component="new-layout-sidebar-section-title">{props.title}</h2>
      <div data-component="new-layout-sidebar-section-content">{props.children}</div>
    </section>
  )
}

function NewLayoutSidebar() {
  const command = useCommand()
  const language = useLanguage()
  const layout = useLayout()
  const location = useLocation()
  const platform = usePlatform()
  const server = useServer()
  const tabs = useTabs()
  const projects = layout.projects.list
  const recentTabs = createMemo(() => tabs.store.slice().reverse())
  const currentHref = createMemo(() => `${location.pathname}${location.search}`)

  return (
    <nav data-component="new-layout-sidebar" aria-label={language.t("sidebar.nav.projectsAndSessions")}>
      <div data-component="new-layout-sidebar-top">
        <div data-component="new-layout-brand" aria-hidden="true">
          <Mark class="size-5" />
        </div>

        <div data-component="new-layout-sidebar-primary">
          <NewLayoutAction
            icon="edit"
            label={language.t("command.session.new")}
            keybind={command.keybind("session.new")}
            onClick={() => command.trigger("session.new")}
          />
          <NewLayoutAction
            icon="magnifying-glass"
            label={language.t("command.palette")}
            keybind={command.keybind("command.palette")}
            popup="dialog"
            onClick={() => command.trigger("command.palette")}
          />
        </div>

        <div data-component="new-layout-sidebar-content">
          <NewLayoutSection title={language.t("command.project.open")}>
            <Show
              when={projects().length > 0}
              fallback={<div data-component="new-layout-sidebar-empty">{language.t("sidebar.empty.title")}</div>}
            >
              <For each={projects()}>
                {(project) => (
                  <button
                    type="button"
                    data-component="new-layout-sidebar-project"
                    title={project.worktree}
                    onClick={() => void tabs.newDraft({ server: server.key, directory: project.worktree }, "")}
                  >
                    <IconV2 name="folder" size="small" />
                    <span class="min-w-0 flex-1 truncate">{project.name || getFilename(project.worktree)}</span>
                  </button>
                )}
              </For>
            </Show>
          </NewLayoutSection>

          <Show when={recentTabs().length > 0}>
            <NewLayoutSection title={language.t("sidebar.project.recentSessions")}>
              <For each={recentTabs()}>
                {(tab) => {
                  const href = tabHref(tab)
                  const active = () => (tab.type === "draft" ? currentHref() === href : location.pathname === href)
                  return (
                    <A
                      href={href}
                      data-component="new-layout-sidebar-tab"
                      class="new-layout-sidebar-tab"
                      classList={{ "is-active": active() }}
                      aria-current={active() ? "page" : undefined}
                    >
                      <IconV2 name="branch" size="small" />
                      <span class="min-w-0 flex-1 truncate">
                        {tabs.info[tabKey(tab)]?.title ?? language.t("command.session.new")}
                      </span>
                    </A>
                  )
                }}
              </For>
            </NewLayoutSection>
          </Show>
        </div>
      </div>

      <div data-component="new-layout-sidebar-footer">
        <NewLayoutAction
          icon="settings-gear"
          label={language.t("sidebar.settings")}
          keybind={command.keybind("settings.open")}
          popup="dialog"
          onClick={() => command.trigger("settings.open")}
        />
        <NewLayoutAction
          icon="help"
          label={language.t("sidebar.help")}
          onClick={() => void platform.openExternal("https://opencode.ai/desktop-feedback")}
        />
      </div>
    </nav>
  )
}

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
    <div
      data-component="new-layout-shell"
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <NewLayoutSidebar />
      <div data-component="new-layout-workspace" class="relative min-w-0 flex-1 flex flex-col">
        <Titlebar update={update} navigation="sidebar" />
        <main
          data-component="new-layout-main"
          class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict"
        >
          <Suspense>{props.children}</Suspense>
        </main>
      </div>
      <TabsInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}

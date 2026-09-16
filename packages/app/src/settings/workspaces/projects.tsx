import { For, Show, createEffect, createMemo, on, onCleanup, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { displayName, errorMessage, homeProjectDirectories } from "@/shell/layout/helpers"
import { ProjectIcon } from "@/shell/layout/project-icon"
import type { LocalProject } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { usePlatform } from "@/runtime/platform/platform"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { fileManagerApp } from "@/home/projects/file-manager"
import { addProjects } from "@/home/projects/add"
import { revealProject } from "@/home/projects/reveal"
import { showToast } from "@/shell/notifications/toast"
import { settingsProjects } from "../servers/inventory"
import { SettingsList } from "../list"
import "@/settings/settings.css"

export const SettingsProjects: Component<{
  server: ServerConnection.Any
  active?: boolean
  autofocus?: boolean
  onOpenProject: (project: LocalProject) => void
}> = (props) => {
  const language = useLanguage()
  const global = useGlobal()
  const platform = usePlatform()
  const tabs = useTabs()
  const pickDirectory = useDirectoryPicker()
  const [store, setStore] = createStore({ filter: "", menu: undefined as string | undefined })
  let search: HTMLInputElement | undefined
  const context = createMemo(() => global.ensureServerCtx(props.server))
  const projects = createMemo(() => settingsProjects(context()))
  const searchable = createMemo(() => projects().length > 7)
  const filtered = createMemo(() => {
    const query = searchable() ? store.filter.trim().toLowerCase() : ""
    return query ? projects().filter((project) => displayName(project).toLowerCase().includes(query)) : projects()
  })
  createEffect(
    on(
      () => (props.active ?? true) && searchable(),
      (active) => {
        if (!active) return
        const frame = requestAnimationFrame(() => {
          if (props.active !== false && props.autofocus !== false && search?.isConnected)
            search.focus({ preventScroll: true })
        })
        onCleanup(() => cancelAnimationFrame(frame))
      },
    ),
  )
  createEffect(() => {
    if (!searchable()) setStore("filter", "")
  })
  const addProject = () =>
    pickDirectory({
      server: props.server,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => addProjects(context(), homeProjectDirectories(result)),
    })
  const newSession = (project: LocalProject) => {
    context().projects.open(project.worktree)
    context().projects.touch(project.worktree)
    void tabs.newDraft({ server: ServerConnection.key(props.server), directory: project.worktree })
  }
  const canReveal = () =>
    platform.platform === "desktop" && !!platform.revealPath && ServerConnection.local(props.server)
  const reveal = (project: LocalProject) => {
    if (!platform.revealPath || !canReveal()) return
    void revealProject({
      directory: project.worktree,
      reveal: platform.revealPath,
      remove: context().projects.remove,
    })
      .then((revealed) => {
        if (revealed) return
        showToast({
          variant: "error",
          title: language.t("home.project.missing.title"),
          description: language.t("home.project.missing.description", { name: displayName(project) }),
        })
      })
      .catch((cause: unknown) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(cause, language.t("common.requestFailed")),
        }),
      )
  }
  const unseen = (project: LocalProject) =>
    [project.worktree, ...(project.sandboxes ?? [])].reduce(
      (total, directory) => total + context().notification.project.unseenCount(directory),
      0,
    )
  const clearNotifications = (project: LocalProject) => {
    const notification = context().notification
    const directories = [project.worktree, ...(project.sandboxes ?? [])]
    directories
      .filter((directory) => notification.project.unseenCount(directory) > 0)
      .forEach((directory) => notification.project.markViewed(directory))
  }

  return (
    <>
      <div class="settings-tab-header" classList={{ "settings-tab-header--stacked": searchable() }}>
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.projects.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.projects.description")}</span>
          </div>
          <Button variant="ghost-muted" icon="plus" onClick={addProject}>
            {language.t("home.project.add")}
          </Button>
        </div>
        <Show when={searchable()}>
          <div class="settings-tab-search">
            <TextInput
              ref={search}
              type="search"
              appearance="base"
              value={store.filter}
              onInput={(event) => setStore("filter", event.currentTarget.value)}
              placeholder={language.t("settings.projects.search.placeholder")}
              aria-label={language.t("settings.projects.search.placeholder")}
              showClearButton={!!store.filter}
              onClearClick={() => {
                setStore("filter", "")
                search?.focus({ preventScroll: true })
              }}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
            />
          </div>
        </Show>
      </div>

      <div class="settings-tab-body">
        <Show
          when={filtered().length > 0}
          fallback={
            <div class="py-12 text-center text-v2-text-text-muted text-13-regular">
              {language.t("settings.projects.empty")}
            </div>
          }
        >
          <SettingsList variant="catalog">
            <For each={filtered()}>
              {(project) => (
                <div data-component="settings-row" class="group/project relative !gap-2">
                  <button
                    type="button"
                    aria-label={displayName(project)}
                    class="group/target -my-4 flex min-h-[52px] min-w-0 flex-1 items-center gap-2 rounded-[4px] bg-transparent py-4 text-start focus-visible:outline-none focus-visible:[box-shadow:inset_0_0_0_1px_var(--v2-border-border-focus)]"
                    onClick={() => props.onOpenProject(project)}
                  >
                    <ProjectIcon project={project} class="shrink-0" />
                    <span class="flex min-w-0 items-center gap-1">
                      <bdi class="truncate text-[13px] font-[530] leading-5 tracking-[-0.04px] text-v2-text-text-base">
                        {displayName(project)}
                      </bdi>
                      <Icon
                        name="chevron-right"
                        size="small"
                        class="shrink-0 text-v2-icon-icon-muted opacity-0 transition-opacity group-hover/project:opacity-100 group-focus-visible/target:opacity-100 rtl:rotate-180"
                      />
                    </span>
                  </button>
                  <Menu
                    gutter={4}
                    modal={false}
                    placement="bottom-end"
                    open={store.menu === project.worktree}
                    onOpenChange={(open) => setStore("menu", open ? project.worktree : undefined)}
                  >
                    <Menu.Trigger
                      as={IconButton}
                      variant="ghost-muted"
                      size="small"
                      class="-my-0.5"
                      icon={<Icon name="outline-dots" />}
                      aria-label={language.t("common.moreOptions")}
                    />
                    <Menu.Portal>
                      <Menu.Content>
                        <Menu.Item onSelect={() => newSession(project)}>{language.t("command.session.new")}</Menu.Item>
                        <Show when={canReveal()}>
                          <Menu.Item onSelect={() => reveal(project)}>
                            {language.t(fileManagerApp(platform.os ?? "unknown").actionLabel)}
                          </Menu.Item>
                        </Show>
                        <Menu.Item disabled={unseen(project) === 0} onSelect={() => clearNotifications(project)}>
                          {language.t("sidebar.project.clearNotifications")}
                        </Menu.Item>
                        <Menu.Separator />
                        <Menu.Item onSelect={() => context().projects.close(project.worktree)}>
                          {language.t("common.close")}
                        </Menu.Item>
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu>
                </div>
              )}
            </For>
          </SettingsList>
        </Show>
      </div>
    </>
  )
}

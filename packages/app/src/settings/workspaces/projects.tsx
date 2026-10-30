import { Show, createEffect, createMemo, on, type Component, type JSX } from "solid-js"
import { Key } from "@solid-primitives/keyed"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { displayName } from "@opencode/ui/project-avatar"
import { homeProjectDirectories } from "@/shell/layout/helpers"
import type { LocalProject } from "@/shell/state/layout"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { addProjects } from "@/home/projects/add"
import { SettingsSearchEmpty } from "../search-empty"
import { SettingsSearchField } from "../search-field"
import { SettingsProjectRow } from "./project-row"
import "@/settings/search.css"
import "@/settings/settings.css"
import "./project.css"

export const SettingsProjects: Component<{
  server: ServerConnection.Any
  active: boolean
  onOpenProject: (project: LocalProject) => void
  headerAction?: JSX.Element
}> = (props) => {
  const language = useLanguage()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const [store, setStore] = createStore({ filter: "", others: false })
  const context = createMemo(() => global.ensureServerCtx(props.server))

  let focus: string | undefined

  const projects = createMemo(() => context().projects.unique())

  const used = createMemo(
    () =>
      new Set(
        context()
          .projects.used()
          .map((project) => project.id),
      ),
  )

  const others = createMemo(() => projects().filter((project) => !used().has(project.id)))
  const searchable = createMemo(() => projects().length > 7 || others().length > 0)
  const query = createMemo(() => (searchable() ? store.filter.trim().toLowerCase() : ""))

  const filtered = createMemo(() =>
    projects().filter(
      (project) =>
        !query() || [displayName(project), project.worktree].some((value) => value.toLowerCase().includes(query())),
    ),
  )

  const added = createMemo(() => filtered().filter((project) => used().has(project.id)))
  const otherResults = createMemo(() => filtered().filter((project) => !used().has(project.id)))

  createEffect(() => {
    if (!searchable()) setStore("filter", "")
  })

  createEffect(on(context, () => setStore("others", false)))

  const addProject = () =>
    pickDirectory({
      server: props.server,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        const directories = homeProjectDirectories(result)

        void addProjects(context(), directories).then((project) => {
          if (project && directories.length === 1) props.onOpenProject(project)
        })
      },
    })

  return (
    <>
      <div class="settings-tab-header" classList={{ "settings-tab-header--stacked": searchable() }}>
        <div class="settings-tab-header-row">
          <div class="flex min-w-0 flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.projects.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.projects.description")}</span>
          </div>
          <div class="settings-tab-header-actions">
            <Show when={projects().length > 0}>
              <Button variant="ghost-muted" icon="plus" onClick={addProject}>
                {language.t("home.project.add")}
              </Button>
            </Show>
            {props.headerAction}
          </div>
        </div>
        <Show when={searchable()}>
          <SettingsSearchField
            value={store.filter}
            active={props.active}
            onInput={(value) => setStore("filter", value)}
            placeholder={language.t("settings.projects.search.placeholder")}
          />
        </Show>
      </div>

      <div class="settings-tab-body">
        <Show
          when={filtered().length > 0}
          fallback={
            <Show
              when={!store.filter.trim() && projects().length === 0}
              fallback={
                <Show
                  when={store.filter.trim()}
                  fallback={
                    <div class="py-12 text-center text-v2-text-text-muted text-13-regular">
                      {language.t("settings.projects.empty")}
                    </div>
                  }
                >
                  <div class="settings-tab-search-empty">
                    <SettingsSearchEmpty query={store.filter} />
                  </div>
                </Show>
              }
            >
              <div
                data-component="settings-project-empty-card"
                class="settings-project-empty-card flex flex-col items-center gap-2 py-24 text-center"
              >
                <Icon name="folder" size="large" class="mb-2 text-v2-icon-icon-muted" />
                <div class="text-13-medium text-v2-text-text-base">{language.t("settings.projects.empty.title")}</div>
                <div class="text-13-regular text-v2-text-text-muted">
                  {language.t("settings.projects.empty.description")}
                </div>
                <Button variant="neutral" icon="plus" class="mt-6" onClick={addProject}>
                  {language.t("home.project.add")}
                </Button>
              </div>
            </Show>
          }
        >
          <div class="flex flex-col gap-3">
            <Show when={added().length > 0}>
              <div role="list" class="settings-project-list">
                <Key each={added()} by="worktree">
                  {(project) => (
                    <SettingsProjectRow
                      project={project()}
                      server={props.server}
                      onOpen={props.onOpenProject}
                      onMount={(button) => {
                        if (focus !== project().worktree) return
                        focus = undefined
                        requestAnimationFrame(() => button.focus())
                      }}
                    />
                  )}
                </Key>
              </div>
            </Show>
            <Show when={otherResults().length > 0}>
              <Show
                when={!query()}
                fallback={
                  <h3 class="text-13-medium text-v2-text-text-muted">{language.t("settings.projects.other")}</h3>
                }
              >
                <button
                  type="button"
                  class="settings-models-group-trigger project-settings-shared-trigger"
                  aria-label={language.t("settings.projects.other")}
                  aria-expanded={store.others}
                  onClick={() => setStore("others", (value) => !value)}
                >
                  <span class="settings-models-group-chevron">
                    <Icon
                      name="fill-triangle-down"
                      size="small"
                      classList={{ "project-settings-shared-chevron": true, open: store.others }}
                    />
                  </span>
                  <span class="project-settings-shared-label">
                    <span class="settings-models-group-title">{language.t("settings.projects.other")}</span>
                    <span class="project-settings-shared-count">{others().length}</span>
                  </span>
                </button>
              </Show>
              <Show when={store.others || query()}>
                <div role="list" class="settings-project-list">
                  <Key each={otherResults()} by="worktree">
                    {(project) => (
                      <SettingsProjectRow
                        project={project()}
                        server={props.server}
                        onOpen={props.onOpenProject}
                        onAdd={() => (focus = project().worktree)}
                      />
                    )}
                  </Key>
                </div>
              </Show>
            </Show>
          </div>
        </Show>
      </div>
    </>
  )
}

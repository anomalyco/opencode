import { Show, createEffect, createMemo, on, type Component } from "solid-js"
import { Key } from "@solid-primitives/keyed"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection } from "@/runtime/server/registry"
import { displayName, homeProjectDirectories } from "@/shell/layout/helpers"
import type { LocalProject } from "@/shell/state/layout"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { addProjects } from "@/home/projects/add"
import { settingsProjects } from "../servers/inventory"
import { SettingsSearchEmpty } from "../search-empty"
import { SettingsProjectRow } from "./project-row"
import "@/settings/search.css"
import "@/settings/settings.css"

export const SettingsProjects: Component<{
  server: ServerConnection.Any
  onOpenProject: (project: LocalProject) => void
}> = (props) => {
  const language = useLanguage()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const [store, setStore] = createStore({
    filter: "",
    overflow: { start: false, end: false },
  })
  let search: HTMLInputElement | undefined
  const updateOverflow = () => {
    if (!search) return
    const offset = Math.abs(search.scrollLeft)
    setStore("overflow", {
      start: offset > 1,
      end: search.scrollWidth - search.clientWidth - offset > 1,
    })
  }
  createEffect(on(() => store.filter, updateOverflow))
  const context = createMemo(() => global.ensureServerCtx(props.server))
  const projects = createMemo(() => settingsProjects(context()))
  const searchable = createMemo(() => projects().length > 7)
  const filtered = createMemo(() => {
    const query = searchable() ? store.filter.trim().toLowerCase() : ""
    return query ? projects().filter((project) => displayName(project).toLowerCase().includes(query)) : projects()
  })
  createEffect(() => {
    if (!searchable()) setStore("filter", "")
  })
  const addProject = () =>
    pickDirectory({
      server: props.server,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        const directories = homeProjectDirectories(result)
        const directory = addProjects(context(), directories)
        if (!directory) return
        if (directories.length > 1) return
        const project = context()
          .projects.list()
          .find((item) => item.worktree === directory)
        if (!project) return
        props.onOpenProject(project)
      },
    })

  return (
    <>
      <div class="settings-tab-header" classList={{ "settings-tab-header--stacked": searchable() }}>
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.projects.title")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.projects.description")}</span>
          </div>
          <Show when={projects().length > 0}>
            <Button variant="ghost-muted" icon="plus" onClick={addProject}>
              {language.t("home.project.add")}
            </Button>
          </Show>
        </div>
        <Show when={searchable()}>
          <div class="settings-tab-search settings-projects-search">
            <TextInput
              ref={(element) => {
                search = element
                createResizeObserver(element, updateOverflow)
              }}
              type="search"
              appearance="base"
              leadingIcon={<Icon name="magnifying-glass" size="small" />}
              value={store.filter}
              data-overflow-start={store.overflow.start}
              data-overflow-end={store.overflow.end}
              onScroll={updateOverflow}
              onInput={(event) => setStore("filter", event.currentTarget.value)}
              placeholder={language.t("settings.projects.search.placeholder")}
              aria-label={language.t("settings.projects.search.placeholder")}
              showClearButton={!!store.filter}
              clearIcon="circle-xmark"
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
                  <div class="settings-projects-empty">
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
                <div class="text-13-medium text-v2-text-text-base">
                  {language.t("settings.projects.empty.title")}
                </div>
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
          <div role="list" class="settings-project-list">
            <Key each={filtered()} by="worktree">
              {(project) => (
                <SettingsProjectRow project={project()} server={props.server} onOpen={props.onOpenProject} />
              )}
            </Key>
          </div>
        </Show>
      </div>
    </>
  )
}

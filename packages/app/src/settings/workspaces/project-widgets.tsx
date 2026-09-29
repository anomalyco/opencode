import { Icon } from "@opencode/ui/icon"
import { type Component, For, Show, createMemo } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useWidgetsQuery } from "@/runtime/server/widgets"
import { SettingsList } from "@/settings/list"
import "./project.css"

const WidgetRow: Component<{
  title: string
  description?: string
  path: string
  error?: string
}> = (props) => (
  <div class="settings-extension-row project-settings-extension-row">
    <div class="settings-extension-lead">
      <Icon
        name="widget"
        class="project-settings-extension-row-icon"
        classList={{ "text-v2-text-text-muted": !!props.error }}
      />
      <div class="project-settings-extension-row-copy">
        <span class="project-settings-extension-row-name settings-extension-name">{props.title}</span>
        <span class="project-settings-extension-row-description">{props.description ?? props.path}</span>
      </div>
    </div>
    <Show when={props.error}>
      <span class="project-settings-extension-row-status project-settings-extension-row-status-error">
        {props.error}
      </span>
    </Show>
  </div>
)

// Widgets are user-authored panels discovered from disk. The list mirrors the
// Plugins/Skills sections so a widget that fails to load is visible with its
// reason instead of disappearing.
export const ProjectWidgets: Component = () => {
  const language = useLanguage()
  const query = useWidgetsQuery({ key: "settings-widgets" })

  const widgets = createMemo(() => (query.isPending || query.isError ? [] : (query.data?.data ?? [])))
  const empty = () => !query.isPending && !query.isError && widgets().length === 0

  return (
    <div class="project-settings-extension-section">
      <div class="project-settings-extension-section-header">
        <div class="project-settings-extension-section-copy">
          <span>
            {language.t(
              empty()
                ? "project.settings.extensions.empty.widgets.title"
                : "project.settings.extensions.added",
            )}
          </span>
          <Show when={empty()}>
            <span class="project-settings-extension-empty-description">
              {language.t("project.settings.extensions.empty.widgets.description")}
            </span>
          </Show>
        </div>
      </div>
      <Show
        when={!query.isPending}
        fallback={<p class="project-settings-extension-empty-description">{language.t("common.loading")}</p>}
      >
        <Show
          when={!query.isError}
          fallback={
            <div class="project-settings-extension-section-copy" role="status">
              <span class="project-settings-extension-empty-description">
                {language.t("project.settings.extensions.widgets.loadFailed")}
              </span>
            </div>
          }
        >
          <Show when={widgets().length > 0}>
            <SettingsList variant="catalog">
              <For each={widgets()}>
                {(widget) => (
                  <WidgetRow
                    title={widget.title}
                    description={widget.description}
                    path={widget.source.path}
                    error={widget.state.status === "failed" ? widget.state.error : undefined}
                  />
                )}
              </For>
            </SettingsList>
          </Show>
        </Show>
      </Show>
    </div>
  )
}

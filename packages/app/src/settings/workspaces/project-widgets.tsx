import { Icon } from "@opencode/ui/icon"
import { Switch } from "@opencode/ui/switch"
import { type Component, For, Show, createMemo } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useWidgetsQuery } from "@/runtime/server/widgets"
import { SettingsList } from "@/settings/list"
import { useWidgetGrants, type WidgetCapability } from "@/session/widgets/grants"
import "./project.css"

const LEVELS: readonly WidgetCapability[] = ["read", "write", "full"]

const WidgetRow: Component<{
  title: string
  description?: string
  path: string
  error?: string
  requests: readonly WidgetCapability[]
  granted: () => readonly WidgetCapability[]
  onToggle: (capability: WidgetCapability, enabled: boolean) => void
}> = (props) => {
  const language = useLanguage()
  const canGrant = (capability: WidgetCapability) => props.requests.includes(capability)
  return (
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
      <Show
        when={!props.error}
        fallback={
          <span class="project-settings-extension-row-status project-settings-extension-row-status-error">
            {props.error}
          </span>
        }
      >
        <div class="flex items-center gap-3">
          <For each={LEVELS}>
            {(capability) => (
              <span class="flex items-center gap-1.5" title={language.t(`widgets.access.${capability}.description`)}>
                <span class="text-11-regular text-v2-text-text-muted">{language.t(`widgets.access.${capability}`)}</span>
                <Switch
                  checked={props.granted().includes(capability)}
                  disabled={!canGrant(capability)}
                  hideLabel
                  onChange={(checked) => props.onToggle(capability, checked)}
                >
                  {language.t(`widgets.access.${capability}`)}
                </Switch>
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

// Widgets are user-authored panels discovered from disk. The list mirrors the
// Plugins/Skills sections so a widget that fails to load is visible with its
// reason instead of disappearing, and each widget exposes the capabilities the
// user may grant.
export const ProjectWidgets: Component = () => {
  const language = useLanguage()
  const server = useServerSDK()
  const grants = useWidgetGrants()
  const query = useWidgetsQuery({ key: "settings-widgets" })

  const widgets = createMemo(() => (query.isPending || query.isError ? [] : (query.data?.data ?? [])))
  const empty = () => !query.isPending && !query.isError && widgets().length === 0

  return (
    <div class="project-settings-extension-section">
      <div class="project-settings-extension-section-header">
        <div class="project-settings-extension-section-copy">
          <span>
            {language.t(
              empty() ? "project.settings.extensions.empty.widgets.title" : "project.settings.extensions.added",
            )}
          </span>
          <Show when={empty()}>
            <span class="project-settings-extension-empty-description">
              {language.t("project.settings.extensions.empty.widgets.description")}
            </span>
          </Show>
          <Show when={!empty()}>
            <span class="project-settings-extension-empty-description">{language.t("widgets.access.description")}</span>
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
                    requests={widget.requests}
                    granted={() => grants.granted(server.scope, widget.id)}
                    onToggle={(capability, enabled) => grants.toggle(server.scope, widget.id, capability, enabled)}
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

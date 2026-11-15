import { For } from "solid-js"
import { Tabs } from "@opencode/ui/tabs"
import { useSettingsSurface } from "@/settings/surface"
import { Contribution } from "./render"

/** One settings panel per plugin page; the tab value is the SettingsPage id. */
export function PluginSettingsPages() {
  const surface = useSettingsSurface()

  return (
    <For each={surface.plugins.pages()}>
      {(item) => (
        <Tabs.Content value={item.value.id} class="settings-panel">
          <Contribution plugin={item.plugin}>
            {() =>
              item.value.render({
                get target() {
                  const view = surface.view()

                  return view.tab === item.value.id ? view.target : undefined
                },
              })
            }
          </Contribution>
        </Tabs.Content>
      )}
    </For>
  )
}

/**
 * Plugin sections on a host settings page, in contribution order; with `section`, the plugin rows placed in
 * that host section, rendered where the host lists them.
 */
export function PluginSettingsSections(props: { page: "general" | "servers"; section?: "general" }) {
  const surface = useSettingsSurface()

  return (
    <For each={surface.plugins.sections(props.page, props.section)}>
      {(item) => (
        <Contribution plugin={item.plugin}>
          {() =>
            item.value.render({
              get target() {
                return surface.view().target
              },
            })
          }
        </Contribution>
      )}
    </For>
  )
}

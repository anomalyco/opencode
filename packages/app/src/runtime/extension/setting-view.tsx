import { For } from "solid-js"
import { Tabs } from "@opencode/ui/tabs"
import { useSettingsSurface } from "@/settings/surface"
import { Contribution } from "./render"

/** One settings panel per extension page; the tab value is the Setting id. */
export function ExtensionSettingPages() {
  const surface = useSettingsSurface()
  return (
    <For each={surface.extensions.pages()}>
      {(item) => (
        <Tabs.Content value={item.value.id} class="settings-panel">
          <Contribution extension={item.extension}>
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

/** Extension sections on a host settings page, in contribution order. */
export function ExtensionSettingSections(props: { page: "general" | "servers" }) {
  const surface = useSettingsSurface()
  return (
    <For each={surface.extensions.sections(props.page)}>
      {(item) => (
        <Contribution extension={item.extension}>
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

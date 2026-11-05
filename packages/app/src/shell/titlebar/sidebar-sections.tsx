import { createMemo, Show } from "solid-js"
import { BuiltinSlot } from "@opencode/plugin/gui/builtin"
import { usePluginHost } from "@/runtime/plugin/host"
import { PluginSlot } from "@/runtime/plugin/render"

/**
 * The `sidebar.section` slot under the sidebar's list. Absent while nothing contributes; otherwise it takes at most half
 * the sidebar's height and scrolls past it, so a tall section never pushes the list out.
 */
export function SidebarSections(props: { shown: boolean }) {
  const host = usePluginHost()
  const contributed = createMemo(() => host.items(BuiltinSlot).some((item) => item.value.at === "sidebar.section"))

  return (
    <Show when={contributed()}>
      <div
        data-slot="sidebar-sections"
        data-scrollable
        class="mt-2 flex max-h-[50%] min-h-0 w-full shrink-0 flex-col gap-2 overflow-y-auto"
      >
        <PluginSlot
          at="sidebar.section"
          input={{
            get shown() {
              return props.shown
            },
          }}
        />
      </div>
    </Show>
  )
}

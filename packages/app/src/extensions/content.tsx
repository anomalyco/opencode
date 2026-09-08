import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import type { RegisteredPanel } from "./provider"

/** Grouped content stays mounted while any declaration in its group is available. */
export function ExtensionPanelContent(props: { panels: readonly RegisteredPanel[]; active: string | undefined }) {
  const selected = createMemo(() => props.panels.find((panel) => panel.key === props.active))
  const groups = createMemo(() => Array.from(new Set(props.panels.filter((panel) => panel.props.group).map(groupKey))))
  const single = createMemo(() => {
    const panel = selected()
    return panel && !panel.props.group ? panel : undefined
  })
  return (
    <>
      <For each={groups()}>
        {(key) => {
          const [mounted, setMounted] = createSignal(false)
          const active = () => !!selected() && groupKey(selected()!) === key
          const declaration = props.panels.find((panel) => groupKey(panel) === key)!
          createEffect(() => {
            if (active()) setMounted(true)
          })
          return (
            <Show when={mounted()}>
              <div
                role="tabpanel"
                data-slot="tabs-content"
                class="h-full min-h-0 overflow-hidden flex flex-col"
                classList={{ hidden: !active() }}
                inert={!active()}
                aria-label={selected()?.props.title}
              >
                {declaration.render()}
              </div>
            </Show>
          )
        }}
      </For>
      <Show when={single()} keyed>
        {(panel) => (
          <div
            role="tabpanel"
            data-slot="tabs-content"
            class="h-full min-h-0 overflow-hidden flex flex-col"
            aria-label={panel.props.title}
          >
            {panel.render()}
          </div>
        )}
      </Show>
    </>
  )
}

function groupKey(panel: RegisteredPanel) {
  return `${panel.session.key}/${panel.plugin}/${panel.generation}/${panel.props.group ?? panel.key}`
}

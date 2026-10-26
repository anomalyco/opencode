import { Show, onCleanup, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { useExtension } from "../sdk"

/** A terminal's side panel tab label: renamed by double-click or its context menu, which also closes it. */
export function TerminalTabLabel(props: {
  label: string
  title: string
  rename: (title: string) => void
  close: () => void
}): JSX.Element {
  const extension = useExtension()
  const [store, setStore] = createStore({ editing: false, title: "" })
  let input: HTMLInputElement | undefined
  let frame: number | undefined
  let renameRequested = false

  const edit = () => {
    setStore({ editing: true, title: props.title })

    // A blur fired while the trigger releases focus would end the edit before it starts.
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      frame = undefined
      input?.focus()
      input?.select()
    })
  }

  const save = () => {
    if (!store.editing) return
    const value = store.title.trim()

    if (value && value !== props.title) props.rename(value)
    setStore("editing", false)
  }

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame)
  })

  // The label renders inside the strip's tab trigger, so the field keeps its keys and pointer from the trigger.
  const isolate = (event: Event) => event.stopPropagation()

  return (
    <Menu.Context>
      <Menu.Context.Trigger as="div" class="relative flex min-w-0 items-center gap-1.5">
        <Icon name="terminal" size="small" />
        <span
          class="max-w-40 truncate"
          data-slot="terminal-tab-title"
          classList={{ invisible: store.editing }}
          onDblClick={(event) => {
            event.stopPropagation()
            edit()
          }}
        >
          {props.label}
        </span>
        <Show when={store.editing}>
          <input
            ref={input}
            type="text"
            aria-label={extension.t("common.rename")}
            value={store.title}
            onInput={(event) => setStore("title", event.currentTarget.value)}
            onBlur={save}
            onKeyDown={(event) => {
              event.stopPropagation()

              if (event.key === "Enter") {
                event.preventDefault()
                save()

                return
              }

              if (event.key !== "Escape") return
              event.preventDefault()
              setStore("editing", false)
            }}
            onKeyUp={isolate}
            onPointerDown={isolate}
            onMouseDown={isolate}
            onClick={isolate}
            class="absolute inset-y-0 start-5 end-0 min-w-0 bg-v2-background-bg-layer-01 rounded-[4px] border-none outline-none px-1 text-[13px] leading-4 text-v2-text-text-base"
          />
        </Show>
      </Menu.Context.Trigger>
      <Menu.Context.Portal>
        <Menu.Context.Content
          onCloseAutoFocus={(event) => {
            if (!renameRequested) return
            event.preventDefault()
            renameRequested = false
            edit()
          }}
        >
          <Menu.Item onSelect={() => (renameRequested = true)}>{extension.t("common.rename")}</Menu.Item>
          <Menu.Item onSelect={() => props.close()}>{extension.t("common.close")}</Menu.Item>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}

import { Show, type JSX } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { usePlugin } from "@opencode/plugin/gui"
import { createInlineRename } from "./inline-rename"

/**
 * A terminal's side panel tab label: renamed by double-click or its context menu, which also closes it. Without
 * `rename` the terminal cannot be renamed.
 */
export function TerminalTabLabel(props: {
  label: string
  title: string
  /** Receives the edited title, or `null` for an emptied field; unchanged titles are the receiver's to skip. */
  rename?: (title: string | null) => void
  close: () => void
}): JSX.Element {
  const plugin = usePlugin()
  const rename = createInlineRename({ title: () => props.title, rename: () => props.rename })

  // The label renders inside the strip's tab trigger, so the field keeps its keys, pointer and focus from the trigger:
  // the tab list returns focus that enters it from outside to the trigger.
  const isolate = (event: Event) => event.stopPropagation()

  return (
    <Menu.Context>
      <Menu.Context.Trigger as="div" class="relative flex min-w-0 items-center gap-1.5">
        <Icon name="terminal" size="small" />
        <span
          class="max-w-40 truncate"
          data-slot="terminal-tab-title"
          classList={{ invisible: rename.editing() }}
          onDblClick={(event) => {
            event.stopPropagation()
            rename.start("pointer")
          }}
        >
          {props.label}
        </span>
        <Show when={rename.editing()}>
          <input
            ref={rename.ref}
            type="text"
            aria-label={plugin.t("common.rename")}
            value={rename.draft()}
            onInput={(event) => rename.change(event.currentTarget.value)}
            onBlur={rename.blur}
            onKeyDown={(event) => {
              event.stopPropagation()
              rename.keydown(event)
            }}
            onKeyUp={isolate}
            onFocusIn={isolate}
            onPointerDown={isolate}
            onMouseDown={isolate}
            onClick={isolate}
            class="absolute inset-y-0 start-5 end-0 min-w-0 bg-v2-background-bg-layer-01 rounded-[4px] border-none outline-none px-1 text-[13px] leading-4 text-v2-text-text-base"
          />
        </Show>
      </Menu.Context.Trigger>
      <Menu.Context.Portal>
        <Menu.Context.Content onCloseAutoFocus={rename.closeAutoFocus}>
          <Menu.Item disabled={!props.rename} onSelect={() => rename.start("menu")}>
            {plugin.t("common.rename")}
          </Menu.Item>
          <Menu.Item onSelect={() => props.close()}>{plugin.t("common.close")}</Menu.Item>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}

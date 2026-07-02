import type { JSX } from "solid-js"
import { Show, createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { useTerminal, type LocalPTY } from "@/context/terminal"
import { useLanguage } from "@/context/language"
import { focusTerminalById } from "@/pages/session/helpers"
import { terminalTabLabel } from "@/pages/session/terminal-label"

export function SortableTerminalTabV2(props: {
  terminal: LocalPTY
  onClose?: () => void
  dragged: boolean
  pressed: boolean
  dragActive: boolean
  onStripPointerDown: (event: PointerEvent) => void
}): JSX.Element {
  const terminal = useTerminal()
  const language = useLanguage()
  const [store, setStore] = createStore({
    editing: false,
    title: props.terminal.title,
    menuOpen: false,
    menuPosition: { x: 0, y: 0 },
    blurEnabled: false,
  })
  let input: HTMLInputElement | undefined
  let blurFrame: number | undefined
  let editRequested = false

  const label = () =>
    terminalTabLabel({
      title: props.terminal.title,
      titleNumber: props.terminal.titleNumber,
      t: language.t as (key: string, vars?: Record<string, string | number | boolean>) => string,
    })

  const close = () => {
    const count = terminal.all().length
    void terminal.close(props.terminal.id)
    if (count === 1) {
      props.onClose?.()
    }
  }

  const focus = () => {
    if (store.editing) return
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    focusTerminalById(props.terminal.id)
  }

  const edit = (e?: Event) => {
    if (e) {
      e.stopPropagation()
      e.preventDefault()
    }

    setStore("blurEnabled", false)
    setStore("title", props.terminal.title)
    setStore("editing", true)
  }

  const save = () => {
    if (!store.blurEnabled) return

    const value = store.title.trim()
    if (value && value !== props.terminal.title) {
      terminal.update({ id: props.terminal.id, title: value })
    }
    setStore("editing", false)
  }

  const keydown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      save()
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      setStore("editing", false)
    }
  }

  const menu = (e: MouseEvent) => {
    e.preventDefault()
    setStore("menuPosition", { x: e.clientX, y: e.clientY })
    setStore("menuOpen", true)
  }

  createEffect(() => {
    if (!store.editing) return
    if (!input) return
    input.focus()
    input.select()
    if (blurFrame !== undefined) cancelAnimationFrame(blurFrame)
    blurFrame = requestAnimationFrame(() => {
      blurFrame = undefined
      setStore("blurEnabled", true)
    })
  })

  onCleanup(() => {
    if (blurFrame === undefined) return
    cancelAnimationFrame(blurFrame)
  })

  return (
    <div
      data-session-tab-slot
      data-tab-key={props.terminal.id}
      class="session-review-v2-file-tab-slot flex shrink-0 items-center touch-none"
      classList={{
        "pointer-events-none": props.dragActive,
        invisible: props.dragged,
        "session-review-v2-file-tab-slot--pressed": props.pressed,
      }}
      onPointerDown={(event) => {
        if (props.dragged) return
        props.onStripPointerDown(event)
      }}
    >
      <div class="relative">
        <TabsV2.Trigger
          value={props.terminal.id}
          data-session-tab
          onClick={focus}
          onMouseDown={(e) => e.preventDefault()}
          onMiddleClick={close}
          onContextMenu={menu}
          onDblClick={edit}
        >
          <div classList={{ invisible: store.editing }}>{label()}</div>
          <div class="-mr-1.5">
            <IconButtonV2
              size="small"
              variant="ghost-muted"
              class="session-review-v2-tab-close"
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                close()
              }}
              icon={<IconV2 name="xmark-small" />}
              aria-label={language.t("terminal.close")}
            />
          </div>
        </TabsV2.Trigger>
        <Show when={store.editing}>
          <div class="absolute inset-0 flex items-center px-3 bg-muted z-10 pointer-events-auto">
            <input
              ref={input}
              type="text"
              value={store.title}
              onInput={(e) => setStore("title", e.currentTarget.value)}
              onBlur={save}
              onKeyDown={keydown}
              onMouseDown={(e) => e.stopPropagation()}
              class="bg-transparent border-none outline-none text-sm min-w-0 flex-1"
            />
          </div>
        </Show>
        <DropdownMenu open={store.menuOpen} onOpenChange={(open) => setStore("menuOpen", open)}>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              class="fixed"
              style={{
                left: `${store.menuPosition.x}px`,
                top: `${store.menuPosition.y}px`,
              }}
              onCloseAutoFocus={(e) => {
                if (!editRequested) return
                e.preventDefault()
                editRequested = false
                requestAnimationFrame(() => edit())
              }}
            >
              <DropdownMenu.Item onSelect={() => (editRequested = true)}>
                <Icon name="edit" class="w-4 h-4 mr-2" />
                {language.t("common.rename")}
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={close}>
                <Icon name="close" class="w-4 h-4 mr-2" />
                {language.t("common.close")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>
    </div>
  )
}

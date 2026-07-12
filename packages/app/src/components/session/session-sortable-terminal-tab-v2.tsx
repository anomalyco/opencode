import type { JSX } from "solid-js"
import { Show, createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useSortable } from "@dnd-kit/solid/sortable"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { isDefaultTitle as isDefaultTerminalTitle } from "@/context/terminal-title"
import { useTerminal, type LocalPTY } from "@/context/terminal"
import { useLanguage } from "@/context/language"
import { focusTerminalById } from "@/pages/session/helpers"

export function SortableTerminalTabV2(props: {
  terminal: LocalPTY
  index: () => number
  newLayout: boolean
  onClose?: () => void
}): JSX.Element {
  const terminal = useTerminal()
  const language = useLanguage()
  const sortable = useSortable({
    get id() {
      return props.terminal.id
    },
    get index() {
      return props.index()
    },
  })
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

  const isDefaultTitle = () => {
    const number = props.terminal.titleNumber
    if (!Number.isFinite(number) || number <= 0) return false
    return isDefaultTerminalTitle(props.terminal.title, number)
  }

  const label = () => {
    language.locale()
    if (props.terminal.title && !isDefaultTitle()) return props.terminal.title

    const number = props.terminal.titleNumber
    if (Number.isFinite(number) && number > 0) return language.t("terminal.title.numbered", { number })
    if (props.terminal.title) return props.terminal.title
    return language.t("terminal.title")
  }

  const close = () => {
    const count = terminal.all().length
    void terminal.close(props.terminal.id)
    if (count === 1) {
      props.onClose?.()
    }
  }

  const focus = () => {
    if (store.editing) return
    terminal.open(props.terminal.id)
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
      ref={sortable.ref}
      class="outline-none focus:outline-none focus-visible:outline-none"
      classList={{
        "h-full flex items-center": props.newLayout,
        "h-full": !props.newLayout,
      }}
    >
      <Show
        when={props.newLayout}
        fallback={
          <div class="relative h-full">
            <Tabs.Trigger
              value={props.terminal.id}
              onClick={focus}
              onMouseDown={(e) => e.preventDefault()}
              onContextMenu={menu}
              class="!shadow-none"
              classes={{
                button: "border-0 outline-none focus:outline-none focus-visible:outline-none !shadow-none !ring-0",
              }}
              closeButton={
                <IconButton
                  icon="close"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    close()
                  }}
                  aria-label={language.t("terminal.close")}
                />
              }
            >
              <span onDblClick={edit} classList={{ invisible: store.editing }}>
                {label()}
              </span>
            </Tabs.Trigger>
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
        }
      >
        <MenuV2.Context>
          <MenuV2.Context.Trigger class="relative" as="div">
            <Tabs.Trigger
              value={props.terminal.id}
              onMouseDown={(e) => {
                // Switch on mousedown to shave the press-release delay off tab switches.
                if (e.button !== 0) return
                if (store.editing) return
                focus()
              }}
              onClick={(e) => {
                // Mouse navigation already happened on mousedown; detail 0 means keyboard activation.
                if (e.detail > 0) return
                focus()
              }}
              closeButton={
                <IconButton
                  icon="close-small"
                  variant="ghost"
                  class="h-5 w-5"
                  onClick={(e) => {
                    e.stopPropagation()
                    close()
                  }}
                  aria-label={language.t("terminal.close")}
                />
              }
              hideCloseButton
              onMiddleClick={close}
            >
              <span
                class="truncate"
                data-slot="terminal-tab-title"
                onDblClick={edit}
                classList={{ invisible: store.editing }}
              >
                {label()}
              </span>
            </Tabs.Trigger>
            <Show when={store.editing}>
              <div class="absolute inset-0 flex items-center bg-v2-background-bg-layer-01 z-10 pointer-events-auto rounded-[6px] shadow-[inset_0_0_0_0.5px_var(--v2-border-border-muted)] px-2">
                <input
                  ref={input}
                  type="text"
                  value={store.title}
                  onInput={(e) => setStore("title", e.currentTarget.value)}
                  onBlur={save}
                  onKeyDown={keydown}
                  onMouseDown={(e) => e.stopPropagation()}
                  class="bg-transparent border-none outline-none min-w-0 flex-1 p-0 text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-base [font-weight:440] [font-variation-settings:'slnt'_0] [font-variant-numeric:tabular-nums]"
                />
              </div>
            </Show>
          </MenuV2.Context.Trigger>
          <MenuV2.Context.Portal>
            <MenuV2.Context.Content
              onCloseAutoFocus={(e) => {
                if (!editRequested) return
                e.preventDefault()
                editRequested = false
                requestAnimationFrame(() => edit())
              }}
            >
              <MenuV2.Item onSelect={() => (editRequested = true)}>{language.t("common.rename")}</MenuV2.Item>
              <MenuV2.Item onSelect={close}>{language.t("common.close")}</MenuV2.Item>
            </MenuV2.Context.Content>
          </MenuV2.Context.Portal>
        </MenuV2.Context>
      </Show>
    </div>
  )
}

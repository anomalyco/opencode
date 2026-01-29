import type { JSX } from "solid-js"
import { Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createSortable } from "@thisbeyond/solid-dnd"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tabs } from "@opencode-ai/ui/tabs"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { useTerminal, type LocalPTY } from "@/context/terminal"
import { useLanguage } from "@/context/language"

export function SortableTerminalTab(props: { terminal: LocalPTY; onClose?: () => void }): JSX.Element {
  const terminal = useTerminal()
  const language = useLanguage()
  const sortable = createSortable(props.terminal.id)
  const [store, setStore] = createStore({
    editing: false,
    title: props.terminal.title,
    menuOpen: false,
    menuPosition: { x: 0, y: 0 },
    blurEnabled: false,
  })

  const isDefaultTitle = () => {
    const number = props.terminal.titleNumber
    if (!Number.isFinite(number) || number <= 0) return false
    const match = props.terminal.title.match(/^Terminal (\d+)$/)
    if (!match) return false
    const parsed = Number(match[1])
    if (!Number.isFinite(parsed) || parsed <= 0) return false
    return parsed === number
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
    terminal.close(props.terminal.id)
    if (count === 1) {
      props.onClose?.()
    }
  }

  const focus = () => {
    if (store.editing) return

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    const wrapper = document.getElementById(`terminal-wrapper-${props.terminal.id}`)
    const element = wrapper?.querySelector('[data-component="terminal"]') as HTMLElement
    if (!element) return

    const textarea = element.querySelector("textarea") as HTMLTextAreaElement
    if (textarea) {
      textarea.focus()
      return
    }
    element.focus()
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }))
  }

  const edit = (e?: Event) => {
    if (e) {
      e.stopPropagation()
      e.preventDefault()
    }

    setStore("blurEnabled", false)
    setStore("title", props.terminal.title)
    setStore("editing", true)
    setTimeout(() => {
      const input = document.getElementById(`terminal-title-input-${props.terminal.id}`) as HTMLInputElement
      if (!input) return
      input.focus()
      input.select()
      setTimeout(() => setStore("blurEnabled", true), 100)
    }, 10)
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

  return (
    <div
      // @ts-ignore
      use:sortable
      class="outline-none focus:outline-none focus-visible:outline-none"
      classList={{
        "h-full": true,
        "opacity-0": sortable.isActiveDraggable,
      }}
    >
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
              id={`terminal-title-input-${props.terminal.id}`}
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
            >
              <DropdownMenu.Item onSelect={edit}>
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

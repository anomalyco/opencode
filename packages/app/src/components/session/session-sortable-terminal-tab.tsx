import type { JSX } from "solid-js"
import { createSignal, Show } from "solid-js"
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
  const [editing, setEditing] = createSignal(false)
  const [title, setTitle] = createSignal(props.terminal.title)
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [menuPosition, setMenuPosition] = createSignal({ x: 0, y: 0 })
  const [blurEnabled, setBlurEnabled] = createSignal(false)

  const label = () => {
    language.locale()
    const number = props.terminal.titleNumber
    if (Number.isFinite(number) && number > 0) {
      return language.t("terminal.title.numbered", { number })
    }
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
    if (editing()) return

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

    setBlurEnabled(false)
    setTitle(props.terminal.title)
    setEditing(true)
    setTimeout(() => {
      const input = document.getElementById(`terminal-title-input-${props.terminal.id}`) as HTMLInputElement
      if (!input) return
      input.focus()
      input.select()
      setTimeout(() => setBlurEnabled(true), 100)
    }, 10)
  }

  const save = () => {
    if (!blurEnabled()) return

    const value = title().trim()
    if (value && value !== props.terminal.title) {
      terminal.update({ id: props.terminal.id, title: value })
    }
    setEditing(false)
  }

  const keydown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      save()
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      setEditing(false)
    }
  }

  const menu = (e: MouseEvent) => {
    e.preventDefault()
    setMenuPosition({ x: e.clientX, y: e.clientY })
    setMenuOpen(true)
  }

  return (
    // @ts-ignore
    <div use:sortable classList={{ "h-full": true, "opacity-0": sortable.isActiveDraggable }}>
      <div class="relative h-full">
        <Tabs.Trigger
          value={props.terminal.id}
          onClick={focus}
          onMouseDown={(e) => e.preventDefault()}
          onContextMenu={menu}
          closeButton={
            <IconButton
              icon="close"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation()
                close()
              }}
            />
          }
        >
          <span onDblClick={edit} style={{ visibility: editing() ? "hidden" : "visible" }}>
            {label()}
          </span>
        </Tabs.Trigger>
        <Show when={editing()}>
          <div class="absolute inset-0 flex items-center px-3 bg-muted z-10 pointer-events-auto">
            <input
              id={`terminal-title-input-${props.terminal.id}`}
              type="text"
              value={title()}
              onInput={(e) => setTitle(e.currentTarget.value)}
              onBlur={save}
              onKeyDown={keydown}
              onMouseDown={(e) => e.stopPropagation()}
              class="bg-transparent border-none outline-none text-sm min-w-0 flex-1"
            />
          </div>
        </Show>
        <DropdownMenu open={menuOpen()} onOpenChange={setMenuOpen}>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              style={{
                position: "fixed",
                left: `${menuPosition().x}px`,
                top: `${menuPosition().y}px`,
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

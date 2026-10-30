import type { JSX } from "solid-js"
import { Show, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { PersistentPtyInfo } from "@opencode/client"
import { Tabs } from "@opencode/ui/tabs"
import { Menu } from "@opencode/ui/menu"
import { usePlugin } from "@opencode/plugin/gui"
import type { TerminalSession } from "./model"
import { terminalTabLabel } from "./title"
import { focusTerminalById } from "./focus"

/** A terminal's tab in the narrow-screen view. Without `rename` the terminal cannot be renamed. */
export function TerminalTab(props: {
  terminal: PersistentPtyInfo
  session: TerminalSession
  /** Receives the edited title, or `null` for an emptied field; unchanged titles are the receiver's to skip. */
  rename?: (title: string | null) => void
}): JSX.Element {
  const plugin = usePlugin()

  const [store, setStore] = createStore({
    editing: false,
    title: props.terminal.title,
    blurEnabled: false,
  })

  let input: HTMLInputElement | undefined
  let blurFrame: number | undefined
  let editFrame: number | undefined
  let editRequested = false

  const label = () => terminalTabLabel({ title: props.terminal.title, t: plugin.t })

  const close = () => void props.session.close(props.terminal.id)

  const focus = () => {
    if (store.editing) return
    props.session.requestFocus(props.terminal.id)
    props.session.select(props.terminal.id)

    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    focusTerminalById(props.terminal.id)
    const input = document.getElementById(`terminal-wrapper-${props.terminal.id}`)?.querySelector("textarea")

    if (input === document.activeElement) props.session.consumeFocus(props.terminal.id)
  }

  const edit = (e?: Event) => {
    if (e) {
      e.stopPropagation()
      e.preventDefault()
    }

    if (!props.rename) return

    const editing = store.editing

    setStore("blurEnabled", false)
    setStore("title", props.terminal.title)
    setStore("editing", true)

    // The input mounts with `editing`; a rename already in progress keeps its focus.
    if (editing || !input) return

    input.focus()
    input.select()

    if (blurFrame !== undefined) cancelAnimationFrame(blurFrame)

    blurFrame = requestAnimationFrame(() => {
      blurFrame = undefined
      setStore("blurEnabled", true)
    })
  }

  // Ending the edit unmounts the focused field, whose blur would save again, or save a cancelled title.
  // The field renders inside the strip's tab trigger, so it keeps its keys, pointer and focus from the trigger: the
  // tab list returns focus that enters it from outside to the trigger.
  const isolate = (event: Event) => event.stopPropagation()

  const save = () => {
    if (!store.editing || !store.blurEnabled) return

    props.rename?.(store.title.trim() || null)
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

  onCleanup(() => {
    if (blurFrame !== undefined) cancelAnimationFrame(blurFrame)

    if (editFrame !== undefined) cancelAnimationFrame(editFrame)
  })

  return (
    <div class="h-full flex items-center outline-none focus:outline-none focus-visible:outline-none">
      <Menu.Context>
        <Menu.Context.Trigger class="relative" as="div">
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
            onMiddleClick={close}
            closeButton={<Tabs.CloseButton class="h-5 w-5" onClick={close} aria-label={plugin.t("close")} />}
            hideCloseButton
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
                aria-label={plugin.t("common.rename")}
                value={store.title}
                onInput={(e) => setStore("title", e.currentTarget.value)}
                onBlur={save}
                onKeyDown={(e) => {
                  isolate(e)
                  keydown(e)
                }}
                onKeyUp={isolate}
                onFocusIn={isolate}
                onPointerDown={isolate}
                onMouseDown={isolate}
                onClick={isolate}
                class="bg-transparent border-none outline-none min-w-0 flex-1 p-0 text-[13px] leading-4 tracking-[-0.04px] text-v2-text-text-base [font-weight:440] [font-variation-settings:'slnt'_0] [font-variant-numeric:tabular-nums]"
              />
            </div>
          </Show>
        </Menu.Context.Trigger>
        <Menu.Context.Portal>
          <Menu.Context.Content
            onCloseAutoFocus={(e) => {
              if (!editRequested) return
              e.preventDefault()
              editRequested = false

              if (editFrame !== undefined) cancelAnimationFrame(editFrame)
              editFrame = requestAnimationFrame(() => {
                editFrame = undefined
                edit()
              })
            }}
          >
            <Menu.Item disabled={!props.rename} onSelect={() => (editRequested = true)}>
              {plugin.t("common.rename")}
            </Menu.Item>
            <Menu.Item onSelect={close}>{plugin.t("common.close")}</Menu.Item>
          </Menu.Context.Content>
        </Menu.Context.Portal>
      </Menu.Context>
    </div>
  )
}

import { createMemo, Match, Show, Switch, untrack } from "solid-js"
import type { JSX } from "solid-js"
import { useSortable } from "@dnd-kit/solid/sortable"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { Tabs } from "@opencode/ui/tabs"
import type { MountedSession, PanelTab } from "@opencode/gui-extensions/sdk"
import { useLanguage } from "@/runtime/i18n/language"
import { useCommand } from "@/shell/commands/command"
import { Contribution } from "./render"

/** One side panel tab trigger. The extension supplies the content; the host owns close, drag, and ids. */
export function PanelTrigger(props: {
  value: string
  extension: string
  tab: PanelTab
  session: MountedSession
  index: number
  active: boolean
  preview: boolean
  onClose: (value: string) => void
  onPromote: (value: string) => void
}): JSX.Element {
  const language = useLanguage()
  const command = useCommand()
  const closeKeybind = createMemo(() => command.keybindParts("file.close"))

  // The label renders once per label function; state is read through getters so neither selection nor a session
  // switch remounts it.
  const state = {
    get active() {
      return props.active
    },
    get preview() {
      return props.preview
    },
    get session() {
      return props.session
    },
  }

  const label = createMemo(() => props.tab.label)

  const rendered = createMemo(() => {
    const render = label()

    if (!render) return

    return <Contribution extension={props.extension}>{() => untrack(() => render(state))}</Contribution>
  })

  const content = () => rendered() ?? props.tab.title

  const tooltip = (button: JSX.Element) => (
    <Tooltip
      value={
        <>
          {language.t("common.closeTab")}
          <Show when={closeKeybind().length > 0}>
            <Keybind keys={closeKeybind()} variant="neutral" />
          </Show>
        </>
      }
      placement="bottom"
      gutter={10}
    >
      {button}
    </Tooltip>
  )

  const closeButton = (reveal: boolean) =>
    tooltip(
      <IconButton
        size="small"
        variant="ghost-muted"
        class={reveal ? "hover-reveal relative z-10 group-hover:opacity-100" : undefined}
        classList={reveal ? { "opacity-100": props.active } : undefined}
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          props.onClose(props.value)
        }}
        icon={<Icon name="xmark-small" />}
        aria-label={language.t("common.closeTab")}
      />,
    )

  const compactClose = () =>
    tooltip(<Tabs.CloseButton onClick={() => props.onClose(props.value)} aria-label={language.t("common.closeTab")} />)

  // The close button `closable` asks for; a plain one by default.
  const close = () => {
    const closable = props.tab.closable

    if (closable === false) return undefined

    if (closable === "compact") return compactClose()

    return closeButton(closable === "hover")
  }

  return (
    <Switch fallback={<SortableTrigger {...props} content={content()} close={close()} />}>
      <Match when={props.tab.pinned}>
        <Tabs.Trigger
          value={props.value}
          id={props.tab.dom?.tab}
          aria-controls={props.active ? props.tab.dom?.panel : undefined}
        >
          {content()}
        </Tabs.Trigger>
      </Match>
      <Match when={props.tab.draggable === false && props.tab.closable === "compact"}>
        <Tabs.Trigger
          value={props.value}
          id={props.tab.dom?.tab}
          onMiddleClick={() => props.onClose(props.value)}
          closeButton={compactClose()}
          hideCloseButton
        >
          {content()}
        </Tabs.Trigger>
      </Match>
      <Match when={props.tab.draggable === false}>
        <Tabs.Trigger
          value={props.value}
          id={props.tab.dom?.tab}
          class="group"
          onMiddleClick={props.tab.closable === false ? undefined : () => props.onClose(props.value)}
          closeButton={close()}
          hideCloseButton
        >
          {content()}
        </Tabs.Trigger>
      </Match>
    </Switch>
  )
}

function SortableTrigger(props: {
  value: string
  tab: PanelTab
  index: number
  active: boolean
  preview: boolean
  content: JSX.Element
  close: JSX.Element | undefined
  onClose: (value: string) => void
  onPromote: (value: string) => void
}): JSX.Element {
  const sortable = useSortable({
    get id() {
      return props.value
    },
    get index() {
      return props.index
    },
  })

  return (
    <div ref={sortable.ref} class="h-full flex items-center">
      <div class="relative">
        <Tabs.Trigger
          value={props.value}
          id={props.tab.dom?.tab}
          aria-controls={props.active ? props.tab.dom?.panel : undefined}
          aria-label={props.tab.missing ? props.tab.title : undefined}
          onMiddleClick={props.tab.closable === false ? undefined : () => props.onClose(props.value)}
          onDblClick={() => {
            if (props.preview) props.onPromote(props.value)
          }}
          closeButton={props.close}
          hideCloseButton
        >
          {props.content}
        </Tabs.Trigger>
      </div>
    </div>
  )
}

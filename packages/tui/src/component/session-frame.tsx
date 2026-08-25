import type { PersistentPtyInfo } from "@opencode-ai/client"
import { RGBA, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  type JSX,
} from "solid-js"
import { useConfig } from "../config"
import { useData } from "../context/data"
import { Keymap } from "../context/keymap"
import { useSessionTerminals } from "../context/session-terminals"
import { usePromptRef } from "../context/prompt"
import { useTheme, useThemes } from "../context/theme"
import { Session } from "../routes/session"
import { Sidebar } from "../routes/session/sidebar"
import { createAnimatable, tween } from "../ui/animation"
import { SplitBorder } from "../ui/border"
import { SESSION_SIDEBAR_WIDTH } from "../ui/layout"
import { useToast } from "../ui/toast"
import { TerminalPane } from "./terminal-pane"

type TerminalPickerState = {
  entries: { id: string; title: string }[]
  selected: number
  onMove: (index: number) => void
  onSelect: () => void
  onClose: () => void
}

export function SessionFrame(props: { sessionID: string; verticalTabsWidth: number }) {
  const sessions = useSessionTerminals()
  const keymap = Keymap.use()
  const prompt = usePromptRef()
  const config = useConfig()
  const data = useData()
  const toast = useToast()
  const dimensions = useTerminalDimensions()
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [sidebarSelected, setSidebarSelected] = createSignal(false)
  const [sessionWidth, setSessionWidth] = createSignal<number>()
  const [terminalTitles, setTerminalTitles] = createSignal<Record<string, string>>({})
  const [terminalFocused, setTerminalFocused] = createSignal(false)
  const [restoreTerminalFocus, setRestoreTerminalFocus] = createSignal(false)
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const [pickerSelected, setPickerSelected] = createSignal(0)
  let focusTerminal: (() => void) | undefined
  createResource(
    () => props.sessionID,
    (sessionID) => sessions.load(sessionID).catch(() => undefined),
  )
  const session = () => sessions.get(props.sessionID)
  const terminals = () => session()?.terminals ?? []
  const selectedTerminal = () => {
    const value = session()
    return value?.terminals.find((terminal) => terminal.id === value.selectedTerminalID) ?? value?.terminals.at(-1)
  }
  createEffect(
    on(
      () => selectedTerminal()?.id,
      () => setSidebarSelected(false),
      { defer: true },
    ),
  )
  const wide = createMemo(() => dimensions().width - props.verticalTabsWidth > 120)
  const sidebarVisible = createMemo(() => {
    if (data.session.get(props.sessionID)?.parentID) return false
    if (sidebarOpen()) return true
    return (config.data.session?.sidebar ?? "auto") === "auto" && wide()
  })
  const showSidebar = () => sidebarVisible() && (!selectedTerminal() || sidebarSelected())
  const showTerminal = () => !!selectedTerminal() && !showSidebar()
  const overlaySidebar = () => showSidebar() && !wide()
  const rightVisible = () => showTerminal() || (showSidebar() && !overlaySidebar())
  const rightWidth = createAnimatable(
    { width: SESSION_SIDEBAR_WIDTH },
    {
      transition: tween({ duration: 0.2, ease: (progress) => 1 - (1 - progress) ** 3 }),
      enabled: () => config.data.animations ?? true,
    },
  )
  createEffect(() => {
    const width = showTerminal()
      ? Math.max(1, Math.floor((dimensions().width - props.verticalTabsWidth) / 2))
      : SESSION_SIDEBAR_WIDTH
    rightWidth.animate({ width })
  })
  const toggleSidebar = () => {
    batch(() => {
      const visible = showSidebar()
      void config
        .update((draft) => {
          draft.session = { ...draft.session, sidebar: visible ? "hide" : "auto" }
        })
        .catch(toast.error)
      setSidebarOpen(!visible)
      setSidebarSelected(!visible)
    })
  }
  createEffect(() => {
    if (!restoreTerminalFocus() || terminals().length > 0) return
    setRestoreTerminalFocus(false)
    prompt.current?.focus()
  })
  const picker = (): TerminalPickerState | undefined => {
    if (!pickerOpen()) return
    return {
      entries: terminals().map((terminal) => ({
        id: terminal.id,
        title: terminalTitles()[terminal.id] ?? terminal.foregroundProcess ?? terminal.title,
      })),
      selected: pickerSelected(),
      onMove: setPickerSelected,
      onSelect: selectTerminal,
      onClose: () => setPickerOpen(false),
    }
  }
  const selectTerminal = () => {
    const list = terminals()
    const selected = pickerSelected()
    setPickerOpen(false)
    if (selected < list.length) {
      setSidebarSelected(false)
      void sessions.selectTerminal(props.sessionID, list[selected]!.id)
      return
    }
    setSidebarSelected(false)
    void sessions.newTerminal(props.sessionID)
  }

  Keymap.createLayer(() => ({
    commands: [
      {
        id: "pane.focus.left",
        title: "Focus session pane",
        run: () => {
          setPickerOpen(false)
          prompt.current?.focus()
        },
      },
      {
        id: "pane.focus.right",
        title: "Focus terminal pane",
        run: () => {
          setPickerOpen(false)
          setSidebarSelected(false)
          focusTerminal?.()
        },
      },
      {
        id: "terminal.select",
        title: "Select terminal",
        run: () => {
          if (pickerOpen()) {
            setPickerOpen(false)
            return
          }
          const current = selectedTerminal()
          const index = terminals().findIndex((terminal) => terminal.id === current?.id)
          setPickerSelected(index < 0 ? 0 : index)
          setPickerOpen(true)
          void sessions.refresh(props.sessionID)
        },
      },
    ],
  }))

  const offPickerKeys = keymap.intercept(
    "key",
    ({ event }) => {
      if (!pickerOpen()) return
      event.preventDefault()
      event.stopPropagation()
      const count = terminals().length + 1
      if (event.name === "escape") {
        setPickerOpen(false)
        return
      }
      if (event.name === "up" || event.name === "k") {
        setPickerSelected((index) => (index + count - 1) % count)
        return
      }
      if (event.name === "down" || event.name === "j") {
        setPickerSelected((index) => (index + 1) % count)
        return
      }
      if (event.name === "enter" || event.name === "return") selectTerminal()
    },
    { priority: 200 },
  )
  onCleanup(offPickerKeys)

  return (
    <box flexGrow={1} minWidth={0} minHeight={0} flexDirection="row" position="relative">
      <box
        flexGrow={1}
        flexBasis={0}
        minWidth={0}
        minHeight={0}
        position="relative"
        onSizeChange={function () {
          setSessionWidth(this.width)
        }}
      >
        <Session
          verticalTabsWidth={props.verticalTabsWidth}
          promptMuted={terminalFocused()}
          sidebarVisible={showSidebar()}
          onToggleSidebar={toggleSidebar}
          width={sessionWidth()}
        />
        <Show when={terminalFocused()}>
          <box
            position="absolute"
            left={0}
            top={0}
            width="100%"
            height="100%"
            zIndex={1}
            onMouseDown={() => prompt.current?.focus()}
          />
        </Show>
      </box>
      <Show when={rightVisible()}>
        <box flexShrink={0} width={Math.round(rightWidth.value().width)} minWidth={0} minHeight={0}>
          <Show
            when={showSidebar()}
            fallback={
              <Show keyed when={selectedTerminal()}>
                {(terminal) => (
                  <TerminalPanel
                    info={terminal}
                    picker={picker()}
                    onFocusChange={setTerminalFocused}
                    onFocusRequest={(value) => (focusTerminal = value)}
                    restoreFocus={restoreTerminalFocus()}
                    onAutoFocus={() => setRestoreTerminalFocus(false)}
                    onDisconnect={() => setRestoreTerminalFocus(true)}
                    onTitle={(title) => setTerminalTitles((titles) => ({ ...titles, [terminal.id]: title }))}
                  />
                )}
              </Show>
            }
          >
            <Sidebar sessionID={props.sessionID} fill />
          </Show>
        </box>
      </Show>
      <Show when={overlaySidebar()}>
        <box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          alignItems="flex-end"
          backgroundColor={RGBA.fromInts(0, 0, 0, 70)}
        >
          <Sidebar sessionID={props.sessionID} />
        </box>
      </Show>
    </box>
  )
}

function TerminalPanel(props: {
  info: PersistentPtyInfo
  picker?: TerminalPickerState
  onFocusChange: (focused: boolean) => void
  onFocusRequest: (focus: (() => void) | undefined) => void
  restoreFocus: boolean
  onAutoFocus: () => void
  onDisconnect: () => void
  onTitle: (title: string) => void
}) {
  const sessions = useSessionTerminals()
  const [terminalTitle, setTerminalTitle] = createSignal(props.info.title)
  const [foregroundProcess, setForegroundProcess] = createSignal(props.info.foregroundProcess ?? undefined)
  const [focused, setFocused] = createSignal(false)
  let focusTerminal: (() => void) | undefined
  return (
    <PaneSurface
      focus={() => focusTerminal?.()}
      title={foregroundProcess() ?? terminalTitle()}
      focused={focused()}
      picker={props.picker}
    >
      <TerminalPane
        ptyID={props.info.id}
        autoFocus={props.restoreFocus || sessions.shouldFocus(props.info.id)}
        onAutoFocus={() => {
          sessions.clearFocus(props.info.id)
          props.onAutoFocus()
        }}
        onFocusRequest={(value) => {
          focusTerminal = value
          props.onFocusRequest(value)
        }}
        onDisconnect={props.onDisconnect}
        onFocusChange={(value) => {
          setFocused(value)
          props.onFocusChange(value)
        }}
        onInfo={(info) => {
          setTerminalTitle(info.title)
          setForegroundProcess(info.foregroundProcess)
          props.onTitle(info.foregroundProcess ?? info.title)
        }}
        onTitleChange={(title) => {
          setTerminalTitle(title)
          if (!foregroundProcess()) props.onTitle(title)
        }}
        onForegroundProcessChange={(process) => {
          setForegroundProcess(process)
          props.onTitle(process ?? terminalTitle())
        }}
      />
    </PaneSurface>
  )
}

function PaneSurface(props: {
  focus: () => void
  title: string
  focused: boolean
  picker?: TerminalPickerState
  children: JSX.Element
}) {
  const theme = useTheme()
  const themes = useThemes()
  const config = useConfig()
  const shortcut = Keymap.useShortcut("terminal.select")
  const background = () => themes.currentTokens().contextual.elevated.background.default
  const title = createAnimatable(
    { opacity: 0 },
    {
      transition: tween({ duration: 0.2 }),
      enabled: () => config.data.animations ?? true,
    },
  )
  let hideTitle: ReturnType<typeof setTimeout> | undefined
  const revealTitle = () => {
    title.jump({ opacity: 1 })
    clearTimeout(hideTitle)
    hideTitle = setTimeout(() => title.animate({ opacity: 0 }), 2_000)
  }
  onCleanup(() => clearTimeout(hideTitle))
  return (
    <box
      flexGrow={1}
      minWidth={0}
      minHeight={0}
      flexDirection="column"
      position="relative"
      backgroundColor={background()}
      onMouseMove={revealTitle}
      onMouseOver={revealTitle}
    >
      <box flexGrow={1} minWidth={0} minHeight={0} position="relative" backgroundColor={background()}>
        {props.children}
      </box>
      <Show when={props.picker}>{(picker) => <TerminalPicker {...picker()} />}</Show>
      <Show when={title.value().opacity > 0}>
        <box
          position="absolute"
          top={0}
          left={0}
          right={0}
          height={1}
          paddingLeft={1}
          paddingRight={1}
          flexDirection="row"
          backgroundColor={background()}
          opacity={title.value().opacity}
          zIndex={1}
          onMouseDown={props.focus}
        >
          <text
            fg={props.focused ? theme.text.formfield.selected : theme.text.subdued}
            bg={background()}
            wrapMode="none"
            truncate
            flexGrow={1}
            minWidth={0}
          >
            Terminal: {props.title}
          </text>
          <Show when={shortcut()}>
            {(value) => (
              <>
                <text fg={theme.text.default} bg={background()} wrapMode="none" flexShrink={0}>
                  {value()}
                </text>
                <text fg={theme.text.subdued} bg={background()} wrapMode="none" flexShrink={0}>
                  {" "}
                  terminals
                </text>
              </>
            )}
          </Show>
        </box>
      </Show>
    </box>
  )
}

function TerminalPicker(props: TerminalPickerState) {
  const theme = useTheme("elevated")
  const options = () => [...props.entries, { id: "", title: "+ New terminal" }]
  const background = () => theme.raise(theme.background.default)
  return (
    <box
      {...SplitBorder}
      flexShrink={0}
      flexDirection="column"
      marginLeft={2}
      marginRight={2}
      marginBottom={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      border={["left"]}
      borderColor={theme.border.default}
      backgroundColor={background()}
    >
      <box flexDirection="row" marginBottom={1}>
        <text fg={theme.text.default} attributes={TextAttributes.BOLD} flexGrow={1}>
          Terminals
        </text>
        <text fg={theme.text.subdued}>esc</text>
      </box>
      <For each={options()}>
        {(option, index) => {
          const selected = () => index() === props.selected
          return (
            <box
              height={1}
              backgroundColor={
                selected() ? theme.background.action.primary.focused : theme.background.action.primary.default
              }
              onMouseOver={() => props.onMove(index())}
              onMouseUp={() => {
                props.onMove(index())
                props.onSelect()
              }}
            >
              <text
                fg={selected() ? theme.text.action.primary.focused : theme.text.action.primary.default}
                wrapMode="none"
                truncate
              >
                {option.title}
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}

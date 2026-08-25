import type { PersistentPtyInfo } from "@opencode-ai/client"
import { TextAttributes } from "@opentui/core"
import { createEffect, createResource, createSignal, For, onCleanup, Show, type JSX } from "solid-js"
import { Keymap } from "../context/keymap"
import { usePaneLayout } from "../context/pane-layout"
import { usePromptRef } from "../context/prompt"
import { useTheme, useThemes } from "../context/theme"
import { Session } from "../routes/session"
import { SplitBorder } from "../ui/border"
import { PersistentTerminalPane } from "./persistent-terminal-pane"

type TerminalPickerState = {
  entries: { id: string; title: string }[]
  selected: number
  onMove: (index: number) => void
  onSelect: () => void
  onClose: () => void
}

export function PaneWorkspace(props: { sessionID: string; verticalTabsWidth: number }) {
  const panes = usePaneLayout()
  const keymap = Keymap.use()
  const prompt = usePromptRef()
  const [terminalTitles, setTerminalTitles] = createSignal<Record<string, string>>({})
  const [terminalFocused, setTerminalFocused] = createSignal(false)
  const [restoreTerminalFocus, setRestoreTerminalFocus] = createSignal(false)
  const [pickerOpen, setPickerOpen] = createSignal(false)
  const [pickerSelected, setPickerSelected] = createSignal(0)
  let focusTerminal: (() => void) | undefined
  createResource(
    () => props.sessionID,
    (sessionID) => panes.load(sessionID).catch(() => undefined),
  )
  const workspace = () => panes.get(props.sessionID)
  const terminals = () => workspace()?.terminals ?? []
  const selectedTerminal = () => {
    const value = workspace()
    return value?.terminals.find((terminal) => terminal.id === value.selectedTerminalID) ?? value?.terminals.at(-1)
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
      void panes.selectTerminal(props.sessionID, list[selected]!.id)
      return
    }
    void panes.newTerminal(props.sessionID)
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
          void panes.refresh(props.sessionID)
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
    <Show when={workspace()} fallback={<Session verticalTabsWidth={props.verticalTabsWidth} />}>
      <Show keyed when={selectedTerminal()} fallback={<Session verticalTabsWidth={props.verticalTabsWidth} />}>
        {(terminal) => {
          return (
            <box flexGrow={1} minWidth={0} minHeight={0} flexDirection="row">
              <box flexGrow={0.5} flexBasis={0} minWidth={0} minHeight={0} position="relative">
                <Session verticalTabsWidth={props.verticalTabsWidth} promptMuted={terminalFocused()} />
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
              <box flexGrow={0.5} flexBasis={0} minWidth={0} minHeight={0}>
                <TerminalPane
                  info={terminal}
                  rootSessionID={props.sessionID}
                  picker={picker()}
                  onFocusChange={setTerminalFocused}
                  onFocusRequest={(value) => (focusTerminal = value)}
                  restoreFocus={restoreTerminalFocus()}
                  onAutoFocus={() => setRestoreTerminalFocus(false)}
                  onDisconnect={() => setRestoreTerminalFocus(true)}
                  onTitle={(title) => setTerminalTitles((titles) => ({ ...titles, [terminal.id]: title }))}
                />
              </box>
            </box>
          )
        }}
      </Show>
    </Show>
  )
}

function TerminalPane(props: {
  info: PersistentPtyInfo
  rootSessionID?: string
  picker?: TerminalPickerState
  onFocusChange: (focused: boolean) => void
  onFocusRequest: (focus: (() => void) | undefined) => void
  restoreFocus: boolean
  onAutoFocus: () => void
  onDisconnect: () => void
  onTitle: (title: string) => void
}) {
  const panes = usePaneLayout()
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
      <PersistentTerminalPane
        ptyID={props.info.id}
        autoFocus={!props.rootSessionID || props.restoreFocus || panes.shouldFocus(props.info.id)}
        onAutoFocus={() => {
          panes.clearFocus(props.info.id)
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
  const shortcut = Keymap.useShortcut("terminal.select")
  const background = () => themes.currentTokens().contextual.elevated.background.default
  return (
    <box flexGrow={1} minWidth={0} minHeight={0} flexDirection="column" backgroundColor={background()}>
      <box
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
        backgroundColor={background()}
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
      <box flexGrow={1} minWidth={0} minHeight={0} position="relative" backgroundColor={background()}>
        {props.children}
      </box>
      <Show when={props.picker}>{(picker) => <TerminalPicker {...picker()} />}</Show>
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

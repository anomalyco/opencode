import { CliRenderEvents, RGBA, TextAttributes, type BoxRenderable, type Renderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createResource, createSignal, Match, onCleanup, Show, Switch, type JSX } from "solid-js"
import { usePaneLayout } from "../context/pane-layout"
import type { PaneLayoutNode } from "../context/pane-layout-model"
import { useData } from "../context/data"
import { usePromptRef } from "../context/prompt"
import { useTheme } from "../context/theme"
import { Session } from "../routes/session"
import { PersistentTerminalPane } from "./persistent-terminal-pane"

export function PaneWorkspace(props: { sessionID: string; verticalTabsWidth: number }) {
  const panes = usePaneLayout()
  createResource(
    () => props.sessionID,
    (sessionID) => panes.load(sessionID).catch(() => undefined),
  )
  const workspace = () => panes.get(props.sessionID)
  return (
    <Show when={workspace()} fallback={<Session verticalTabsWidth={props.verticalTabsWidth} />}>
      {(value) => (
        <PaneNode node={value().layout} rootSessionID={props.sessionID} verticalTabsWidth={props.verticalTabsWidth} />
      )}
    </Show>
  )
}

function PaneNode(props: { node: PaneLayoutNode; rootSessionID?: string; verticalTabsWidth: number }) {
  const panes = usePaneLayout()
  const prompt = usePromptRef()
  const theme = useTheme()
  const data = useData()
  return (
    <Switch>
      <Match when={props.node.type === "item" ? props.node.item : undefined}>
        {(item) => {
          let focusTerminal: (() => void) | undefined
          const focus = () => {
            if (item().type === "session" && item().id === props.rootSessionID) {
              prompt.current?.focus()
              return
            }
            focusTerminal?.()
          }
          return (
            <PaneSurface
              focus={focus}
              title={
                item().type === "terminal"
                  ? "Terminal"
                  : `Session · ${data.session.get(item().id)?.title ?? "Untitled"}`
              }
            >
              <Switch>
                <Match when={item().type === "session" && item().id === props.rootSessionID}>
                  <Session verticalTabsWidth={props.verticalTabsWidth} />
                </Match>
                <Match when={item().type === "session"}>
                  <UnavailablePane label={`Session ${item().id}`} />
                </Match>
                <Match when={item().type === "terminal"}>
                  <PersistentTerminalPane
                    ptyID={item().id}
                    autoFocus={!props.rootSessionID || panes.shouldFocus(item().id)}
                    onAutoFocus={() => panes.clearFocus(item().id)}
                    onFocusRequest={(value) => (focusTerminal = value)}
                  />
                </Match>
              </Switch>
            </PaneSurface>
          )
        }}
      </Match>
      <Match when={props.node.type === "split" ? props.node : undefined}>
        {(node) => (
          <box
            flexGrow={1}
            minWidth={0}
            minHeight={0}
            flexDirection={node().direction === "horizontal" ? "row" : "column"}
          >
            <box flexGrow={node().ratio} flexBasis={0} minWidth={0} minHeight={0}>
              <PaneNode
                node={node().first}
                rootSessionID={props.rootSessionID}
                verticalTabsWidth={props.verticalTabsWidth}
              />
            </box>
            <box flexGrow={1 - node().ratio} flexBasis={0} minWidth={0} minHeight={0}>
              <PaneNode
                node={node().second}
                rootSessionID={props.rootSessionID}
                verticalTabsWidth={props.verticalTabsWidth}
              />
            </box>
          </box>
        )}
      </Match>
    </Switch>
  )
}

function PaneSurface(props: { focus: () => void; title: string; children: JSX.Element }) {
  const renderer = useRenderer()
  const theme = useTheme()
  const [focused, setFocused] = createSignal(false)
  let pane: BoxRenderable | undefined
  const contains = (current: Renderable | null) => {
    while (current) {
      if (current === pane) return true
      current = current.parent
    }
    return false
  }
  const onFocused = (current: Renderable | null) => setFocused(contains(current))
  renderer.on(CliRenderEvents.FOCUSED_RENDERABLE, onFocused)
  onCleanup(() => renderer.off(CliRenderEvents.FOCUSED_RENDERABLE, onFocused))
  return (
    <box
      ref={(value) => {
        pane = value
        setFocused(contains(renderer.currentFocusedRenderable))
      }}
      flexGrow={1}
      minWidth={0}
      minHeight={0}
      position="relative"
      flexDirection="column"
    >
      <box
        height={1}
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={
          focused() ? theme.raise(theme.raise(theme.background.surface.offset)) : theme.background.surface.offset
        }
      >
        <text
          fg={focused() ? theme.text.default : theme.text.subdued}
          attributes={focused() ? TextAttributes.BOLD : undefined}
          wrapMode="none"
          truncate
        >
          {props.title}
        </text>
      </box>
      <box flexGrow={1} minWidth={0} minHeight={0} position="relative">
        {props.children}
      </box>
      <Show when={!focused()}>
        <box
          position="absolute"
          left={0}
          top={0}
          width="100%"
          height="100%"
          zIndex={1}
          backgroundColor={RGBA.fromInts(0, 0, 0)}
          opacity={0.3}
          onMouseDown={props.focus}
        />
      </Show>
    </box>
  )
}

function UnavailablePane(props: { label: string }) {
  const theme = useTheme()
  return (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      <text fg={theme.text.subdued}>{props.label} is unavailable in this prototype.</text>
    </box>
  )
}

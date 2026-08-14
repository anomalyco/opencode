import { createResource, Match, Show, Switch } from "solid-js"
import { usePaneLayout } from "../context/pane-layout"
import type { PaneLayoutNode } from "../context/pane-layout-model"
import { useTheme } from "../context/theme"
import { Session } from "../routes/session"
import { PersistentTerminalPane } from "./persistent-terminal-pane"

export function PaneWorkspace(props: { sessionID?: string; groupID?: string; verticalTabsWidth: number }) {
  const panes = usePaneLayout()
  createResource(
    () => props.groupID ?? props.sessionID,
    (key) => (props.groupID ? panes.loadGroup(key) : panes.load(key)).catch(() => undefined),
  )
  const workspace = () => (props.groupID ? panes.getGroup(props.groupID) : props.sessionID ? panes.get(props.sessionID) : undefined)
  return (
    <Show
      when={workspace()}
      fallback={props.sessionID ? <Session verticalTabsWidth={props.verticalTabsWidth} /> : null}
    >
      {(value) => (
        <PaneNode
          node={value().layout}
          rootSessionID={props.sessionID}
          verticalTabsWidth={props.verticalTabsWidth}
        />
      )}
    </Show>
  )
}

function PaneNode(props: { node: PaneLayoutNode; rootSessionID?: string; verticalTabsWidth: number }) {
  const theme = useTheme()
  return (
    <Switch>
      <Match when={props.node.type === "item" ? props.node.item : undefined}>
        {(item) => (
          <Switch>
            <Match when={item().type === "session" && item().id === props.rootSessionID}>
              <Session verticalTabsWidth={props.verticalTabsWidth} />
            </Match>
            <Match when={item().type === "session"}>
              <UnavailablePane label={`Session ${item().id}`} />
            </Match>
            <Match when={item().type === "terminal"}>
              <PersistentTerminalPane ptyID={item().id} autoFocus={!props.rootSessionID} />
            </Match>
          </Switch>
        )}
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
            <box
              flexGrow={1 - node().ratio}
              flexBasis={0}
              minWidth={0}
              minHeight={0}
              border={node().direction === "horizontal" ? ["left"] : ["top"]}
              borderColor={theme.border.default}
            >
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

function UnavailablePane(props: { label: string }) {
  const theme = useTheme()
  return (
    <box flexGrow={1} alignItems="center" justifyContent="center">
      <text fg={theme.text.subdued}>{props.label} is unavailable in this prototype.</text>
    </box>
  )
}

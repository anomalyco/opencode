// packages/opencode/src/cli/cmd/tui/layout/renderer.tsx
import { For, Match, Show, Switch, createMemo, type Component } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useLayout } from "../context/layout"
import { Layout } from "./types"
import { ViewRegistry } from "../view/registry"
import { View } from "../view/types"

// Built-in view components
import { Session } from "../routes/session"
import { Home } from "../routes/home"
import { WindowIDProvider } from "../context/window-id"

function parseViewID(viewID: string): { type: string; sessionID?: string } {
  const idx = viewID.indexOf(":")
  if (idx === -1) return { type: viewID }
  return { type: viewID.slice(0, idx), sessionID: viewID.slice(idx + 1) }
}

// Generic view renderers for plugin views
const TreeViewRenderer: Component<{ view: View.Tree.Info }> = (props) => {
  const { theme } = useTheme()

  function renderNode(node: View.Tree.NodeInfo, depth: number) {
    const indent = "  ".repeat(depth)
    const icon = node.children.length > 0 ? (node.expanded ? "▼" : "▶") : " "

    return (
      <>
        <text fg={props.view.selectedID === node.id ? theme.accent : theme.text}>
          {indent}
          {icon} {node.icon ? `${node.icon} ` : ""}
          {node.label}
        </text>
        <Show when={node.expanded}>
          <For each={node.children}>{(child) => renderNode(child, depth + 1)}</For>
        </Show>
      </>
    )
  }

  return (
    <box flexDirection="column">
      <text fg={theme.text}>
        <span style={{ bold: true }}>{props.view.title}</span>
      </text>
      <For each={props.view.nodes}>{(node) => renderNode(node, 0)}</For>
    </box>
  )
}

const ListViewRenderer: Component<{ view: View.List.Info }> = (props) => {
  const { theme } = useTheme()

  return (
    <box flexDirection="column">
      <text fg={theme.text}>
        <span style={{ bold: true }}>{props.view.title}</span>
      </text>
      <Show when={props.view.searchable}>
        <text fg={theme.textMuted}>Search: {props.view.searchQuery ?? ""}</text>
      </Show>
      <For each={props.view.items}>
        {(item) => (
          <text fg={props.view.selectedID === item.id ? theme.accent : theme.text}>
            {item.icon ? `${item.icon} ` : ""}
            {item.label}
            <Show when={item.description}>
              <span style={{ fg: theme.textMuted }}> - {item.description}</span>
            </Show>
          </text>
        )}
      </For>
    </box>
  )
}

const TextViewRenderer: Component<{ view: View.Text.Info }> = (props) => {
  const { theme, syntax } = useTheme()

  return (
    <box flexDirection="column">
      <text fg={theme.text}>
        <span style={{ bold: true }}>{props.view.title}</span>
      </text>
      <Show when={props.view.filetype} fallback={<text fg={theme.text}>{props.view.content}</text>}>
        <code filetype={props.view.filetype} syntaxStyle={syntax()} content={props.view.content} fg={theme.text} />
      </Show>
    </box>
  )
}

const FormViewRenderer: Component<{ view: View.Form.Info }> = (props) => {
  const { theme } = useTheme()

  return (
    <box flexDirection="column">
      <text fg={theme.text}>
        <span style={{ bold: true }}>{props.view.title}</span>
      </text>
      <For each={props.view.fields}>
        {(field) => (
          <box flexDirection="row" gap={1}>
            <text fg={theme.text}>{field.label}:</text>
            <Switch>
              <Match when={field.type === "text" && field}>
                {(f) => <text fg={theme.textMuted}>[{f().value ?? f().placeholder ?? ""}]</text>}
              </Match>
              <Match when={field.type === "toggle" && field}>
                {(f) => <text fg={theme.accent}>{f().value ? "[x]" : "[ ]"}</text>}
              </Match>
              <Match when={field.type === "select" && field}>
                {(f) => <text fg={theme.textMuted}>[{f().value ?? "select..."}]</text>}
              </Match>
              <Match when={field.type === "number" && field}>
                {(f) => <text fg={theme.textMuted}>[{f().value ?? 0}]</text>}
              </Match>
            </Switch>
          </box>
        )}
      </For>
    </box>
  )
}

// View renderer that dispatches to appropriate component
const ViewRenderer: Component<{ viewID: string }> = (props) => {
  const parsed = createMemo(() => parseViewID(props.viewID))
  const view = createMemo(() => ViewRegistry.get(props.viewID))

  return (
    <Switch>
      <Match when={parsed().type === "home"}>
        <Home />
      </Match>
      <Match when={parsed().type === "session"}>
        <Session />
      </Match>
      <Match when={view()?.type === "tree"}>
        <TreeViewRenderer view={view() as View.Tree.Info} />
      </Match>
      <Match when={view()?.type === "list"}>
        <ListViewRenderer view={view() as View.List.Info} />
      </Match>
      <Match when={view()?.type === "text"}>
        <TextViewRenderer view={view() as View.Text.Info} />
      </Match>
      <Match when={view()?.type === "form"}>
        <FormViewRenderer view={view() as View.Form.Info} />
      </Match>
    </Switch>
  )
}

// Window renderer
const WindowRenderer: Component<{
  window: Layout.Window.Info
  width: number
  height: number
}> = (props) => {
  const { theme } = useTheme()
  const layout = useLayout()
  const focused = createMemo(() => layout.layout.focusedID === props.window.id)

  return (
    <box
      width={props.width}
      height={props.height}
      border={focused() ? ["left", "right", "top", "bottom"] : undefined}
      borderColor={focused() ? theme.borderActive : undefined}
    >
      <WindowIDProvider windowID={props.window.id}>
        <ViewRenderer viewID={props.window.viewID} />
      </WindowIDProvider>
    </box>
  )
}

// Split renderer
const SplitRenderer: Component<{
  split: Layout.Split.SplitInfo
  width: number
  height: number
}> = (props) => {
  const isHorizontal = () => props.split.direction === "horizontal"

  const childDimensions = createMemo(() => {
    return props.split.children.map((_, i) => {
      const ratio = props.split.ratios[i] ?? 1 / props.split.children.length
      if (isHorizontal()) {
        return { width: props.width, height: Math.floor(props.height * ratio) }
      }
      return { width: Math.floor(props.width * ratio), height: props.height }
    })
  })

  return (
    <box flexDirection={isHorizontal() ? "column" : "row"} width={props.width} height={props.height}>
      <For each={props.split.children}>
        {(child, i) => (
          <Switch>
            <Match when={child.type === "window"}>
              <WindowRenderer
                window={child as Layout.Window.Info}
                width={childDimensions()[i()].width}
                height={childDimensions()[i()].height}
              />
            </Match>
            <Match when={child.type === "split"}>
              <SplitRenderer
                split={child as Layout.Split.SplitInfo}
                width={childDimensions()[i()].width}
                height={childDimensions()[i()].height}
              />
            </Match>
          </Switch>
        )}
      </For>
    </box>
  )
}

// Float renderer
const FloatRenderer: Component<{ float: Layout.Float.Info }> = (props) => {
  const { theme } = useTheme()
  const layout = useLayout()
  const focused = createMemo(() => layout.layout.focusedID === props.float.id)

  return (
    <box
      position="absolute"
      left={props.float.x}
      top={props.float.y}
      width={props.float.width}
      height={props.float.height}
      border={["left", "right", "top", "bottom"]}
      borderColor={focused() ? theme.borderActive : theme.border}
      backgroundColor={theme.background}
      zIndex={100}
    >
      <ViewRenderer viewID={props.float.viewID} />
    </box>
  )
}

// Main layout renderer
export const LayoutRenderer: Component = () => {
  const dimensions = useTerminalDimensions()
  const layout = useLayout()
  const { theme } = useTheme()

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background}>
      <Switch>
        <Match when={layout.layout.root.type === "window"}>
          <WindowRenderer
            window={layout.layout.root as Layout.Window.Info}
            width={dimensions().width}
            height={dimensions().height}
          />
        </Match>
        <Match when={layout.layout.root.type === "split"}>
          <SplitRenderer
            split={layout.layout.root as Layout.Split.SplitInfo}
            width={dimensions().width}
            height={dimensions().height}
          />
        </Match>
      </Switch>
      <For each={layout.layout.floats}>{(float) => <FloatRenderer float={float} />}</For>
    </box>
  )
}

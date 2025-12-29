// packages/opencode/src/cli/cmd/tui/layout/renderer.tsx
import { For, Match, Show, Switch, createMemo, type Component } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useLayout } from "../context/layout"
import { Layout } from "./types"
import { ViewRegistry } from "../view/registry"
import { View } from "../view/types"

// Built-in view components
import { Session } from "../routes/session"
import { Home } from "../routes/home"

// View component registry
const VIEW_COMPONENTS: Record<string, Component<{ view?: View.Info }>> = {
  session: () => <Session />,
  home: () => <Home />,
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
      <text fg={theme.text} bold>
        {props.view.title}
      </text>
      <For each={props.view.nodes}>{(node) => renderNode(node, 0)}</For>
    </box>
  )
}

const ListViewRenderer: Component<{ view: View.List.Info }> = (props) => {
  const { theme } = useTheme()

  return (
    <box flexDirection="column">
      <text fg={theme.text} bold>
        {props.view.title}
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
      <text fg={theme.text} bold>
        {props.view.title}
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
      <text fg={theme.text} bold>
        {props.view.title}
      </text>
      <For each={props.view.fields}>
        {(field) => (
          <box flexDirection="row" gap={1}>
            <text fg={theme.text}>{field.label}:</text>
            <Switch>
              <Match when={field.type === "text"}>
                <text fg={theme.textMuted}>[{(field as any).value ?? (field as any).placeholder ?? ""}]</text>
              </Match>
              <Match when={field.type === "toggle"}>
                <text fg={theme.accent}>{(field as any).value ? "[x]" : "[ ]"}</text>
              </Match>
              <Match when={field.type === "select"}>
                <text fg={theme.textMuted}>[{(field as any).value ?? "select..."}]</text>
              </Match>
              <Match when={field.type === "number"}>
                <text fg={theme.textMuted}>[{(field as any).value ?? 0}]</text>
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
  const view = createMemo(() => ViewRegistry.get(props.viewID))

  return (
    <Switch>
      <Match when={VIEW_COMPONENTS[props.viewID]}>
        <Dynamic component={VIEW_COMPONENTS[props.viewID]} />
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
      borderColor={focused() ? theme.borderActive : theme.border}
    >
      <ViewRenderer viewID={props.window.viewID} />
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

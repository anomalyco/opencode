import type { BorderSides, ColorInput } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { createContext, Show, splitProps, useContext } from "solid-js"

export type Axis = "x" | "y"
export type SeparatorEdge = "edge" | "edge-in" | "edge-out"
export type PanelBorder = "start" | "end" | "both" | "none"

const PanelGroupContext = createContext<{ axis: Axis }>()

function crossAxis(axis: Axis) {
  return axis === "x" ? "y" : "x"
}

function usePanelGroup() {
  return useContext(PanelGroupContext)
}

export function PanelGroup(props: JSX.IntrinsicElements["box"] & { axis: Axis }) {
  const [local, boxProps] = splitProps(props, ["axis", "children"])
  return (
    <PanelGroupContext.Provider value={{ axis: local.axis }}>
      <box minWidth={0} minHeight={0} padding={0} flexDirection={local.axis === "x" ? "row" : "column"} {...boxProps}>
        {local.children}
      </box>
    </PanelGroupContext.Provider>
  )
}

export function Panel(props: Omit<JSX.IntrinsicElements["box"], "border"> & { border?: PanelBorder }) {
  const group = usePanelGroup()
  const { theme } = useTheme()
  const [local, boxProps] = splitProps(props, ["border"])
  const border = local.border ?? "start"
  const borderProps =
    border === "none"
      ? {}
      : {
          border: panelBorderSides(group?.axis ?? "y", border),
          borderColor: theme.border,
        }

  return (
    <box
      minWidth={0}
      minHeight={0}
      flexDirection={crossAxis(group?.axis || "y") === "x" ? "row" : "column"}
      {...borderProps}
      {...boxProps}
    />
  )
}

function panelBorderSides(axis: Axis, border: Exclude<PanelBorder, "none">): BorderSides[] {
  if (axis === "x") return border === "both" ? ["top", "bottom"] : [border === "start" ? "top" : "bottom"]
  return border === "both" ? ["left", "right"] : [border === "start" ? "left" : "right"]
}

export function Separator(props: { axis?: Axis; color?: ColorInput; start?: SeparatorEdge; end?: SeparatorEdge }) {
  const group = usePanelGroup()
  const { theme } = useTheme()
  const color = () => props.color ?? theme.border
  const axis = () => props.axis ?? crossAxis(group?.axis ?? "y")
  if (axis() === "y") {
    return (
      <Show
        when={props.start || props.end}
        fallback={<box width={1} flexShrink={0} border={["left"]} borderColor={color()} />}
      >
        <box width={1} flexShrink={0} flexDirection="column">
          <Show when={props.start}>{(edge) => <text fg={color()}>{verticalEdge(edge(), "start")}</text>}</Show>
          <box flexGrow={1} border={["left"]} borderColor={color()} />
          <Show when={props.end}>{(edge) => <text fg={color()}>{verticalEdge(edge(), "end")}</text>}</Show>
        </box>
      </Show>
    )
  }
  return (
    <Show
      when={props.start || props.end}
      fallback={<box height={1} flexShrink={0} border={["top"]} borderColor={color()} />}
    >
      <box height={1} flexShrink={0} flexDirection="row">
        <Show when={props.start}>{(edge) => <text fg={color()}>{horizontalEdge(edge(), "start")}</text>}</Show>
        <box flexGrow={1} border={["top"]} borderColor={color()} />
        <Show when={props.end}>{(edge) => <text fg={color()}>{horizontalEdge(edge(), "end")}</text>}</Show>
      </box>
    </Show>
  )
}

function horizontalEdge(edge: SeparatorEdge, side: "start" | "end") {
  if (edge === "edge") return side === "start" ? "├" : "┤"
  if (edge === "edge-in") return "┴"
  return "┬"
}

function verticalEdge(edge: SeparatorEdge, side: "start" | "end") {
  if (edge === "edge") return side === "start" ? "┬" : "┴"
  if (edge === "edge-in") return "┤"
  return "├"
}

import type { BorderSides, ColorInput } from "@opentui/core"
import type { Plugin } from "@opencode-ai/plugin/tui"
import type { JSX } from "@opentui/solid"
import { createContext, Show, splitProps, useContext } from "solid-js"

export type Axis = "x" | "y"
export type SeparatorEdge = "edge" | "edge-in" | "edge-out"
export type PanelBorder = "start" | "end" | "both" | "none"

const PanelGroupContext = createContext<{ axis: Axis; context: Plugin.Context }>()

function crossAxis(axis: Axis) {
  return axis === "x" ? "y" : "x"
}

function usePanelGroup() {
  return useContext(PanelGroupContext)
}

export function PanelGroup(props: JSX.IntrinsicElements["box"] & { axis: Axis; context: Plugin.Context }) {
  const [local, boxProps] = splitProps(props, ["axis", "context", "children"])
  return (
    <PanelGroupContext.Provider value={{ axis: local.axis, context: local.context }}>
      <box minWidth={0} minHeight={0} padding={0} flexDirection={local.axis === "x" ? "row" : "column"} {...boxProps}>
        {local.children}
      </box>
    </PanelGroupContext.Provider>
  )
}

export function Panel(
  props: Omit<JSX.IntrinsicElements["box"], "border"> & { border?: PanelBorder; context?: Plugin.Context },
) {
  const group = usePanelGroup()
  const [local, boxProps] = splitProps(props, ["border", "context"])
  const context = local.context ?? group?.context
  if (!context) throw new Error("Panel context is missing")
  const theme = context.theme
  const border = local.border ?? "start"
  const borderProps =
    border === "none"
      ? {}
      : {
          border: panelBorderSides(group?.axis ?? "y", border),
          borderColor: theme.border.default,
        }

  return (
    <box
      minWidth={0}
      minHeight={0}
      flexDirection={crossAxis(group?.axis ?? "y") === "x" ? "row" : "column"}
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
  if (!group) throw new Error("PanelGroup is missing")
  const theme = group.context.theme
  const color = () => props.color ?? theme.border.default
  const axis = () => props.axis ?? crossAxis(group.axis)
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

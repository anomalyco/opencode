import type { JSX } from "solid-js"
import { Show, createSignal } from "solid-js"
import { useTheme } from "../context/theme"

export function SidebarSection(props: {
  title: string
  collapsible?: boolean
  collapsedSummary?: JSX.Element
  children: JSX.Element
}) {
  const [open, setOpen] = createSignal(true)
  const theme = useTheme()

  return (
    <box>
      <box flexDirection="row" gap={1} onMouseDown={() => props.collapsible && setOpen((value) => !value)}>
        <Show when={props.collapsible}>
          <text fg={theme.theme.text}>{open() ? "▼" : "▶"}</text>
        </Show>
        <text fg={theme.theme.text}>
          <b>{props.title}</b>
          <Show when={props.collapsible && !open()}>{props.collapsedSummary}</Show>
        </text>
      </box>
      <Show when={!props.collapsible || open()}>{props.children}</Show>
    </box>
  )
}

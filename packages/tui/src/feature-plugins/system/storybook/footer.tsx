import type { Plugin } from "@opencode-ai/plugin/tui"
import { For, Show } from "solid-js"

export type StoryFooterControl = {
  shortcut: string
  label: string
}

export function StoryFooter(props: {
  context: Plugin.Context
  title: string
  details?: readonly string[]
  status?: string
  message?: string
  controls: readonly StoryFooterControl[]
}) {
  const theme = props.context.theme.contextual.elevated

  return (
    <box flexShrink={0} flexDirection="column" backgroundColor={theme.background.default}>
      <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row">
        <text fg={theme.text.default}>{props.title}</text>
        <Show when={props.details?.length}>
          <text fg={theme.text.subdued}> · {props.details?.join(" · ")}</text>
        </Show>
      </box>
      <Show when={props.status || props.message}>
        <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row">
          <text fg={theme.text.default} wrapMode="none">
            {props.status ?? ""}
            <span style={{ fg: theme.text.subdued }}>
              {props.status && props.message ? " · " : ""}
              {props.message ?? ""}
            </span>
          </text>
        </box>
      </Show>
      <box paddingLeft={1} paddingRight={1} flexDirection="row" flexWrap="wrap" columnGap={1}>
        <For each={props.controls}>
          {(control) => (
            <text fg={theme.text.default} wrapMode="none" flexShrink={0}>
              {control.shortcut} <span style={{ fg: theme.text.subdued }}>{control.label}</span>
            </text>
          )}
        </For>
      </box>
      {/* The app-wide feature footer overlays the terminal's final row. */}
      <box height={1} />
    </box>
  )
}

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
          <text fg={theme.text.default}>{props.status ?? ""}</text>
          <Show when={props.status && props.message}>
            <text fg={theme.text.subdued}> · </text>
          </Show>
          <text fg={theme.text.subdued}>{props.message ?? ""}</text>
        </box>
      </Show>
      <box height={1} paddingLeft={1} paddingRight={1} flexDirection="row">
        <text fg={theme.text.default} wrapMode="none">
          <For each={props.controls}>
            {(control, index) => (
              <>
                <Show when={index() > 0}>
                  <span>  </span>
                </Show>
                {control.shortcut} <span style={{ fg: theme.text.subdued }}>{control.label}</span>
              </>
            )}
          </For>
        </text>
      </box>
      {/* The app-wide feature footer overlays the terminal's final row. */}
      <box height={1} />
    </box>
  )
}

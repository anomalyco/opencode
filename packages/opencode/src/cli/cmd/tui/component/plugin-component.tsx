import { createResource, createSignal, Show, Match, Switch } from "solid-js"
import { useTheme } from "../context/theme"
import { useUIExtensions } from "../context/ui-extensions"
import { TextAttributes } from "@opentui/core"

export interface PluginComponentProps {
  componentId: string
  context?: Record<string, any>
  fallback?: string
}

export function PluginComponent(props: PluginComponentProps) {
  const { theme } = useTheme()
  const uiExtensions = useUIExtensions()
  const [refreshCounter] = createSignal(0)

  const [rendered] = createResource(
    () => ({ id: props.componentId, context: props.context, refresh: refreshCounter() }),
    async (args) => {
      const result = await uiExtensions.renderComponent(args.id, args.context ?? {})
      return result
    },
  )

  return (
    <Switch>
      <Match when={rendered.loading}>
        <text fg={theme.textMuted} attributes={TextAttributes.ITALIC}>
          Loading...
        </text>
      </Match>
      <Match when={rendered.error}>
        <text fg={theme.error}>
          Error: {rendered.error instanceof Error ? rendered.error.message : String(rendered.error)}
        </text>
      </Match>
      <Match when={rendered()?.error}>
        <text fg={theme.error}>{rendered()!.error}</text>
      </Match>
      <Match when={rendered()}>
        {(data) => (
          <Switch>
            <Match when={data().type === "text"}>
              <text fg={theme.text} wrapMode="word">
                {data().content}
              </text>
            </Match>
            <Match when={data().type === "markdown"}>
              {/* For MVP, render markdown as plain text */}
              {/* TODO: Add markdown parsing/rendering if needed */}
              <text fg={theme.text} wrapMode="word">
                {data().content}
              </text>
            </Match>
            <Match when={data().type === "ansi"}>
              {/* OpenTUI should handle ANSI escape codes automatically */}
              <text fg={theme.text} wrapMode="word">
                {data().content}
              </text>
            </Match>
            <Match when={data().type === "html"}>
              {/* HTML not supported in TUI, show fallback */}
              <text fg={theme.textMuted} attributes={TextAttributes.ITALIC}>
                HTML content not supported in TUI
              </text>
            </Match>
          </Switch>
        )}
      </Match>
      <Match when={!rendered()}>
        <Show when={props.fallback} fallback={null}>
          <text fg={theme.textMuted} attributes={TextAttributes.ITALIC}>
            {props.fallback}
          </text>
        </Show>
      </Match>
    </Switch>
  )
}

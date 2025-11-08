import { Prompt } from "@tui/component/prompt"
import { createMemo, Match, Show, Switch, type ParentProps } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "../context/keybind"
import type { KeybindsConfig } from "@opencode-ai/sdk"
import { Logo } from "../component/logo"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"

export function Home() {
  const sync = useSync()
  const { theme } = useTheme()
  const mcpError = createMemo(() => {
    return Object.values(sync.data.mcp).some((x) => x.status === "failed")
  })

  const Hint = (
    <Show when={Object.keys(sync.data.mcp).length > 0}>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <text fg={theme.text}>
          <Switch>
            <Match when={mcpError()}>
              <span style={{ fg: theme.error }}>•</span> mcp errors{" "}
              <span style={{ fg: theme.textMuted }}>ctrl+x s</span>
            </Match>
            <Match when={true}>
              <span style={{ fg: theme.success }}>•</span>{" "}
              {Locale.pluralize(Object.values(sync.data.mcp).length, "{} mcp server", "{} mcp servers")}
            </Match>
          </Switch>
        </text>
      </box>
    </Show>
  )

  return (
    <box flexGrow={1} justifyContent="center" alignItems="center" paddingLeft={2} paddingRight={2} gap={1}>
      <Logo />
      <box width={39}>
        <HelpRow keybind="command_list">Commands</HelpRow>
        <HelpRow keybind="session_list">List sessions</HelpRow>
        <HelpRow keybind="model_list">Switch model</HelpRow>
        <HelpRow keybind="agent_cycle">Switch agent</HelpRow>
      </box>
      <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1}>
        <Prompt hint={Hint} />
      </box>
      <Toast />
    </box>
  )
}

function HelpRow(props: ParentProps<{ keybind: keyof KeybindsConfig }>) {
  const keybind = useKeybind()
  const { theme } = useTheme()
  return (
    <box flexDirection="row" justifyContent="space-between" width="100%">
      <text fg={theme.text}>{props.children}</text>
      <text fg={theme.primary}>{keybind.print(props.keybind)}</text>
    </box>
  )
}

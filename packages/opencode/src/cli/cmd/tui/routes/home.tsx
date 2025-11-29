import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createMemo, Match, onMount, Show, Switch, type ParentProps } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "../context/keybind"
import type { KeybindsConfig } from "@opencode-ai/sdk"
import { Logo } from "../component/logo"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { Global } from "@/global"
import { useDirectory } from "../context/directory"

// TODO: what is the best way to do this?
let once = false

export function Home() {
  const sync = useSync()
  const { theme } = useTheme()
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
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

  let prompt: PromptRef
  const args = useArgs()
  onMount(() => {
    if (once) return
    if (args.prompt) {
      prompt.set({ input: args.prompt, parts: [] })
      once = true
    }
  })
  const directory = useDirectory()

  return (
    <>
      <box flexGrow={1} justifyContent="center" alignItems="center" paddingLeft={2} paddingRight={2} gap={1}>
        <Logo />
        <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1}>
          <Prompt ref={(r) => (prompt = r)} hint={Hint} />
        </box>
        <Toast />
      </box>
      <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0} gap={2}>
        <text fg={theme.textMuted}>{directory()}</text>
        <box gap={1} flexDirection="row" flexShrink={0}>
          <Show when={mcp()}>
            <text fg={theme.text}>
              <Switch>
                <Match when={mcpError()}>
                  <span style={{ fg: theme.error }}>⊙ </span>
                </Match>
                <Match when={true}>
                  <span style={{ fg: theme.success }}>⊙ </span>
                </Match>
              </Switch>
              {Object.keys(sync.data.mcp).length} MCP
            </text>
            <text fg={theme.textMuted}>/status</text>
          </Show>
        </box>
      </box>
    </>
  )
}

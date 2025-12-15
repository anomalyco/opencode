import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createEffect, createMemo, createSignal, Match, Show, Switch, type ParentProps } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "../context/keybind"
import type { KeybindsConfig } from "@forge/sdk"
import { Logo } from "../component/logo"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useLocal } from "../context/local"
import { Log } from "@/util/log"

// TODO: what is the best way to do this?
let once = false

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

  const [promptRef, setPromptRef] = createSignal<PromptRef>()
  let promptPreloaded = false
  const args = useArgs()
  const local = useLocal()
  const log = Log.create({ service: "tui-home" })
  createEffect(() => {
    log.info("prompt.prefill.check", {
      hasPrompt: Boolean(args.prompt),
      switching: local.session.switching,
    })
    if (!args.prompt) return
    const prompt = promptRef()
    if (!prompt) return
    if (promptPreloaded) return
    promptPreloaded = true
    log.info("prompt.prefill.set", { length: args.prompt.length })
    prompt.set({ input: args.prompt, parts: [] })
  })

  createEffect(() => {
    if (once) return
    if (!args.prompt) return
    if (local.session.switching) return
    const prompt = promptRef()
    if (!prompt) return
    once = true
    log.info("prompt.autosubmit", { length: args.prompt.length })
    queueMicrotask(() => {
      void prompt.submit().catch((error) => console.error(error))
    })
  })

  return (
    <box flexGrow={1} justifyContent="center" alignItems="center" paddingLeft={2} paddingRight={2} gap={1}>
      <Logo />
      <box width={39}>
        <HelpRow keybind="command_list">Commands</HelpRow>
        <HelpRow keybind="agent_list">Select agent</HelpRow>
        <HelpRow keybind="model_list">Select model</HelpRow>
        <HelpRow keybind="session_list">List sessions</HelpRow>
      </box>
      <box width="100%" maxWidth={75} zIndex={1000} paddingTop={1}>
        <Prompt ref={(r) => setPromptRef(r)} hint={Hint} />
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

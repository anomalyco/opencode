import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createMemo, Match, onMount, Show, Switch } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { useTerminalDimensions } from "@opentui/solid"
import { Logo } from "../component/logo"
import { Tips } from "../component/tips"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { useKV } from "../context/kv"
import { useCommandDialog } from "../component/dialog-command"

// TODO: what is the best way to do this?
let once = false

export function Home() {
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const terminal = useTerminalDimensions()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const command = useCommandDialog()
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const mcpError = createMemo(() => {
    return Object.values(sync.data.mcp).some((x) => x.status === "failed")
  })

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })

  const isFirstTimeUser = createMemo(() => sync.data.session.length === 0)
  const tipsHidden = createMemo(() => kv.get("tips_hidden", false))
  const showTips = createMemo(() => {
    // Don't show tips for first-time users
    if (isFirstTimeUser()) return false
    return !tipsHidden()
  })

  command.register(() => [
    {
      title: tipsHidden() ? "Show tips" : "Hide tips",
      value: "tips.toggle",
      keybind: "tips_toggle",
      category: "System",
      onSelect: (dialog) => {
        kv.set("tips_hidden", !tipsHidden())
        dialog.clear()
      },
    },
  ])

  const Hint = (
    <Show when={connectedMcpCount() > 0}>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <text fg={theme.text}>
          <Switch>
            <Match when={mcpError()}>
              <span style={{ fg: theme.error }}>•</span> mcp errors{" "}
              <span style={{ fg: theme.textMuted }}>ctrl+x s</span>
            </Match>
            <Match when={true}>
              <span style={{ fg: theme.success }}>•</span>{" "}
              {Locale.pluralize(connectedMcpCount(), "{} mcp server", "{} mcp servers")}
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
    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
      once = true
    } else if (args.prompt) {
      prompt.set({ input: args.prompt, parts: [] })
      once = true
      prompt.submit()
    }
  })
  const directory = useDirectory()

  const keybind = useKeybind()

  const initialPrompt = createMemo(() => sync.data.config.tui?.initial_prompt)
  const size = createMemo(() => initialPrompt()?.size ?? "compact")
  const width = createMemo(() => {
    const value = initialPrompt()?.width_percent
    if (value) return Math.max(40, Math.min(100, value))
    if (size() === "medium") return 80
    if (size() === "large") return 90
    return 75
  })
  const maxWidth = createMemo(() => {
    if (size() === "compact" && !initialPrompt()?.width_percent) return 75
    const available = Math.max(50, terminal().width - 8)
    return Math.max(50, Math.min(available, Math.floor((terminal().width * width()) / 100)))
  })
  const height = createMemo(() => {
    const value = initialPrompt()?.height_percent
    if (value) return Math.max(10, Math.min(60, value))
    if (size() === "medium") return 25
    if (size() === "large") return 35
    return 0
  })
  const maxHeight = createMemo(() => {
    if (size() === "compact" && !initialPrompt()?.height_percent) return 6
    const available = Math.max(6, terminal().height - 18)
    return Math.max(6, Math.min(available, Math.floor((terminal().height * height()) / 100)))
  })
  const top = createMemo(() => {
    if (size() === "medium") return 2
    if (size() === "large") return 1
    return 4
  })
  const tipsHeight = createMemo(() => {
    if (size() === "medium") return 3
    if (size() === "large") return 2
    return 4
  })
  const tipsPadding = createMemo(() => {
    if (size() === "compact") return 3
    if (size() === "medium") return 2
    return 1
  })

  return (
    <>
      <box flexGrow={1} alignItems="center" paddingLeft={2} paddingRight={2}>
        <box flexGrow={1} minHeight={0} />
        <box height={top()} minHeight={0} flexShrink={1} />
        <box flexShrink={0}>
          <Logo />
        </box>
        <box height={1} minHeight={0} flexShrink={1} />
        <box width="100%" maxWidth={maxWidth()} zIndex={1000} paddingTop={1} flexShrink={0}>
          <Prompt
            ref={(r) => {
              prompt = r
              promptRef.set(r)
            }}
            hint={Hint}
            maxHeight={maxHeight()}
          />
        </box>
        <box
          height={tipsHeight()}
          minHeight={0}
          width="100%"
          maxWidth={maxWidth()}
          alignItems="center"
          paddingTop={tipsPadding()}
          flexShrink={1}
        >
          <Show when={showTips()}>
            <Tips />
          </Show>
        </box>
        <Show when={size() !== "compact"}>
          <box width="100%" maxWidth={maxWidth()} alignItems="center" paddingTop={1}>
            <text fg={theme.textMuted}>home prompt size: {size()}</text>
          </box>
        </Show>
        <box flexGrow={1} minHeight={0} />
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
                  <span style={{ fg: connectedMcpCount() > 0 ? theme.success : theme.textMuted }}>⊙ </span>
                </Match>
              </Switch>
              {connectedMcpCount()} MCP
            </text>
            <text fg={theme.textMuted}>/status</text>
          </Show>
        </box>
        <box flexGrow={1} />
        <box flexShrink={0}>
          <text fg={theme.textMuted}>{Installation.VERSION}</text>
        </box>
      </box>
    </>
  )
}

import { useSync } from "../../context/sync"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiPaths } from "../../context/runtime"
import { InstallationVersion, InstallationChannel } from "@opencode-ai/core/installation/version"
import { abbreviateHome } from "../../runtime"
import { useCommandShortcut } from "../../keymap"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function Sidebar(props: { sessionID: string }) {
  const sync = useSync()
  const paths = useTuiPaths()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const paletteShortcut = useCommandShortcut("command.palette.show")

  const lastAssistant = createMemo(() => {
    return (sync.data.message[props.sessionID] ?? []).findLast(
      (msg): msg is AssistantMessage => msg.role === "assistant" && msg.tokens.output > 0,
    )
  })

  const contextInfo = createMemo(() => {
    const last = lastAssistant()
    if (!last) return null
    const tokens = last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((p) => p.id === last.providerID)?.models[last.modelID]
    const percent = model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null
    return { tokens, percent }
  })

  const cost = createMemo(() => session()?.cost ?? 0)

  const pathInfo = createMemo(() => {
    const sessionDir = session()?.directory
    const dir = sessionDir || paths.cwd
    const out = abbreviateHome(dir, paths.home)
    const branch = sessionDir === paths.cwd ? sync.data.vcs?.branch : undefined
    return branch ? out + ":" + branch : out
  })

  return (
    <Show when={session()}>
      <box backgroundColor={theme.backgroundPanel} width="100%" flexShrink={0} paddingLeft={2} paddingRight={2} gap={1}>
        <box flexDirection="row" gap={2}>
          <text fg={theme.text}>
            <b>{session()!.title}</b>
          </text>
          <text fg={theme.textMuted}>·</text>
          <Show when={contextInfo()} fallback={<text fg={theme.textMuted}>0 tokens</text>}>
            {(info) => (
              <text fg={theme.textMuted}>
                {info().tokens.toLocaleString()} tokens ({info().percent ?? 0}%) · {money.format(cost())}
              </text>
            )}
          </Show>
          <text fg={theme.textMuted}>·</text>
          <text fg={theme.textMuted}>{pathInfo()}</text>
        </box>
        <box flexDirection="row" gap={2}>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>•</span> OpenCode {InstallationVersion}
            <Show when={InstallationChannel !== "latest"}> ({InstallationChannel})</Show>
          </text>
          <Show when={paletteShortcut()}>
            <text fg={theme.text}>
              {paletteShortcut()} <span style={{ fg: theme.textMuted }}>commands</span>
            </text>
          </Show>
        </box>
      </box>
    </Show>
  )
}

import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useSync } from "@tui/context/sync"
import { For, Match, Switch, Show, createMemo } from "solid-js"
import { Installation } from "@/installation"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
// test
export type DialogStatusProps = {}

export function DialogStatus() {
  const sync = useSync()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  const enabledFormatters = createMemo(() => sync.data.formatter.filter((f) => f.enabled))

  const plugins = createMemo(() => {
    const list = sync.data.config.plugin ?? []
    const result = list.map((value) => {
      if (value.startsWith("file://")) {
        const path = value.substring("file://".length)
        const parts = path.split("/")
        const filename = parts.pop() || path
        if (!filename.includes(".")) return { name: filename }
        const basename = filename.split(".")[0]
        if (basename === "index") {
          const dirname = parts.pop()
          const name = dirname || basename
          return { name }
        }
        return { name: basename }
      }
      const index = value.lastIndexOf("@")
      if (index <= 0) return { name: value, version: "latest" }
      const name = value.substring(0, index)
      const version = value.substring(index + 1)
      return { name, version }
    })
    return result.toSorted((a, b) => a.name.localeCompare(b.name))
  })

  let scroll: ScrollBoxRenderable | undefined

  useKeyboard((evt) => {
    if (!scroll) return
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      scroll.scrollBy(-1)
      evt.preventDefault()
      evt.stopPropagation()
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      scroll.scrollBy(1)
      evt.preventDefault()
      evt.stopPropagation()
    }
    if (evt.name === "pageup") {
      scroll.scrollBy(-Math.floor(scroll.height / 2))
      evt.preventDefault()
      evt.stopPropagation()
    }
    if (evt.name === "pagedown") {
      scroll.scrollBy(Math.floor(scroll.height / 2))
      evt.preventDefault()
      evt.stopPropagation()
    }
    if (evt.name === "home") {
      scroll.scrollTo(0)
      evt.preventDefault()
      evt.stopPropagation()
    }
    if (evt.name === "end") {
      scroll.scrollTo(scroll.scrollHeight)
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  const contentHeight = createMemo(() => {
    let h = 0
    const mcpCount = Object.keys(sync.data.mcp).length
    if (mcpCount > 0) h += mcpCount + 1
    else h += 1

    const lspCount = sync.data.lsp.length
    if (lspCount > 0) h += lspCount + 2

    const formatterCount = enabledFormatters().length
    h += formatterCount > 0 ? formatterCount + 2 : 2

    const pluginCount = plugins().length
    h += pluginCount > 0 ? pluginCount + 2 : 2

    return h
  })

  const maxHeight = createMemo(() => Math.floor(dimensions().height / 2) - 6)
  const height = createMemo(() => Math.min(contentHeight(), maxHeight()))

  return (
    <box paddingLeft={2} paddingRight={2}>
      <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Status
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>OpenCode v{Installation.VERSION}</text>
      </box>
      <scrollbox
        ref={(r: ScrollBoxRenderable) => {
          scroll = r
        }}
        height={height()}
        verticalScrollbarOptions={{
          visible: true,
          trackOptions: {
            backgroundColor: theme.backgroundPanel,
            foregroundColor: theme.border,
          },
        }}
      >
        <Show when={Object.keys(sync.data.mcp).length > 0} fallback={<text fg={theme.text}>No MCP Servers</text>}>
          <box>
            <text fg={theme.text}>{Object.keys(sync.data.mcp).length} MCP Servers</text>
            <For each={Object.entries(sync.data.mcp)}>
              {([key, item]) => (
                <box flexDirection="row" gap={1}>
                  <text
                    flexShrink={0}
                    style={{
                      fg: (
                        {
                          connected: theme.success,
                          failed: theme.error,
                          disabled: theme.textMuted,
                          needs_auth: theme.warning,
                          needs_client_registration: theme.error,
                        } as Record<string, typeof theme.success>
                      )[item.status],
                    }}
                  >
                    •
                  </text>
                  <text fg={theme.text} wrapMode="word">
                    <b>{key}</b>{" "}
                    <span style={{ fg: theme.textMuted }}>
                      <Switch fallback={item.status}>
                        <Match when={item.status === "connected"}>Connected</Match>
                        <Match when={item.status === "failed" && item}>{(val) => val().error}</Match>
                        <Match when={item.status === "disabled"}>Disabled in configuration</Match>
                        <Match when={item.status === "needs_auth"}>
                          Needs authentication (run: opencode mcp auth {key})
                        </Match>
                        <Match when={item.status === "needs_client_registration" && item}>
                          {(val) => (val() as { error: string }).error}
                        </Match>
                      </Switch>
                    </span>
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>
        {sync.data.lsp.length > 0 && (
          <box marginTop={1}>
            <text fg={theme.text}>{sync.data.lsp.length} LSP Servers</text>
            <For each={sync.data.lsp}>
              {(item) => (
                <box flexDirection="row" gap={1}>
                  <text
                    flexShrink={0}
                    style={{
                      fg: {
                        connected: theme.success,
                        error: theme.error,
                      }[item.status],
                    }}
                  >
                    •
                  </text>
                  <text fg={theme.text} wrapMode="word">
                    <b>{item.id}</b> <span style={{ fg: theme.textMuted }}>{item.root}</span>
                  </text>
                </box>
              )}
            </For>
          </box>
        )}
        <Show
          when={enabledFormatters().length > 0}
          fallback={
            <box marginTop={1}>
              <text fg={theme.text}>No Formatters</text>
            </box>
          }
        >
          <box marginTop={1}>
            <text fg={theme.text}>{enabledFormatters().length} Formatters</text>
            <For each={enabledFormatters()}>
              {(item) => (
                <box flexDirection="row" gap={1}>
                  <text
                    flexShrink={0}
                    style={{
                      fg: theme.success,
                    }}
                  >
                    •
                  </text>
                  <text wrapMode="word" fg={theme.text}>
                    <b>{item.name}</b>
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>
        <Show
          when={plugins().length > 0}
          fallback={
            <box marginTop={1}>
              <text fg={theme.text}>No Plugins</text>
            </box>
          }
        >
          <box marginTop={1}>
            <text fg={theme.text}>{plugins().length} Plugins</text>
            <For each={plugins()}>
              {(item) => (
                <box flexDirection="row" gap={1}>
                  <text
                    flexShrink={0}
                    style={{
                      fg: theme.success,
                    }}
                  >
                    •
                  </text>
                  <text wrapMode="word" fg={theme.text}>
                    <b>{item.name}</b>
                    {item.version && <span style={{ fg: theme.textMuted }}> @{item.version}</span>}
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>
      </scrollbox>
    </box>
  )
}

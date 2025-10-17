import { TextAttributes } from "@opentui/core"
import { Theme } from "../context/theme"
import { useSync } from "@tui/context/sync"
import { For, Match, Switch, Show } from "solid-js"

export type DialogStatusProps = {}

export function DialogStatus() {
  const sync = useSync()

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD}>Status</text>
        <text fg={Theme().textMuted}>esc</text>
      </box>
      <Show when={Object.keys(sync.data.mcp).length > 0}>
        <box>
          <text>{Object.keys(sync.data.mcp).length} MCP Servers</text>
          <For each={Object.entries(sync.data.mcp)}>
            {([key, item]) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: {
                      connected: Theme().success,
                      failed: Theme().error,
                      disabled: Theme().textMuted,
                    }[item.status],
                  }}
                >
                  •
                </text>
                <text wrapMode="word">
                  <b>{key}</b>{" "}
                  <span style={{ fg: Theme().textMuted }}>
                    <Switch>
                      <Match when={item.status === "connected"}>Connected</Match>
                      <Match when={item.status === "failed" && item}>{(val) => val().error}</Match>
                      <Match when={item.status === "disabled"}>Disabled in configuration</Match>
                    </Switch>
                  </span>
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
      {sync.data.lsp.length > 0 && (
        <box>
          <text>{sync.data.lsp.length} LSP Servers</text>
          <For each={sync.data.lsp}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text
                  flexShrink={0}
                  style={{
                    fg: {
                      connected: Theme().success,
                      error: Theme().error,
                    }[item.status],
                  }}
                >
                  •
                </text>
                <text wrapMode="word">
                  <b>{item.id}</b> <span style={{ fg: Theme().textMuted }}>{item.root}</span>
                </text>
              </box>
            )}
          </For>
        </box>
      )}
    </box>
  )
}

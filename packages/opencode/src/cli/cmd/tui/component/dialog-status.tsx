import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { fileURLToPath } from "bun"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { For, Show, createMemo } from "solid-js"
import { plural, resolveLocale, t, type Locale } from "@/i18n"

export type DialogStatusProps = {}

type CountKind = "mcp" | "lsp" | "formatter" | "plugin"

const COUNT = {
  mcp: {
    one: "tui.status.count.mcp.one",
    other: "tui.status.count.mcp.other",
  },
  lsp: {
    one: "tui.status.count.lsp.one",
    other: "tui.status.count.lsp.other",
  },
  formatter: {
    one: "tui.status.count.formatter.one",
    other: "tui.status.count.formatter.other",
  },
  plugin: {
    one: "tui.status.count.plugin.one",
    other: "tui.status.count.plugin.other",
  },
} as const

export function countText(locale: Locale, kind: CountKind, count: number) {
  const key = plural(locale, count, COUNT[kind])
  return t(locale, key, { count })
}

export function mcpStatusText(locale: Locale, name: string, item: { status: string; error?: string }) {
  if (item.status === "connected") return t(locale, "tui.status.connected")
  if (item.status === "disabled") return t(locale, "tui.status.disabled")
  if (item.status === "needs_auth") return t(locale, "tui.status.needs_auth", { name })
  return item.error ?? item.status
}

export function DialogStatus() {
  const sync = useSync()
  const { theme } = useTheme()
  const dialog = useDialog()
  const locale = createMemo(() => resolveLocale(sync.data.config.locale))

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape") {
      dialog.clear()
    }
  })

  const enabledFormatters = createMemo(() => sync.data.formatter.filter((f) => f.enabled))

  const plugins = createMemo(() => {
    const list = sync.data.config.plugin ?? []
    const result = list.map((item) => {
      const value = typeof item === "string" ? item : item[0]
      if (value.startsWith("file://")) {
        const path = fileURLToPath(value)
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

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {t(locale(), "tui.status.title")}
        </text>
        <text fg={theme.textMuted}>{t(locale(), "tui.status.close")}</text>
      </box>
      <Show
        when={Object.keys(sync.data.mcp).length > 0}
        fallback={<text fg={theme.text}>{t(locale(), "tui.status.none.mcp")}</text>}
      >
        <box>
          <text fg={theme.text}>{countText(locale(), "mcp", Object.keys(sync.data.mcp).length)}</text>
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
                  <b>{key}</b> <span style={{ fg: theme.textMuted }}>{mcpStatusText(locale(), key, item)}</span>
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
      {sync.data.lsp.length > 0 && (
        <box>
          <text fg={theme.text}>{countText(locale(), "lsp", sync.data.lsp.length)}</text>
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
        fallback={<text fg={theme.text}>{t(locale(), "tui.status.none.formatter")}</text>}
      >
        <box>
          <text fg={theme.text}>{countText(locale(), "formatter", enabledFormatters().length)}</text>
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
      <Show when={plugins().length > 0} fallback={<text fg={theme.text}>{t(locale(), "tui.status.none.plugin")}</text>}>
        <box>
          <text fg={theme.text}>{countText(locale(), "plugin", plugins().length)}</text>
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
    </box>
  )
}

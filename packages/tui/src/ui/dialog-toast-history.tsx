import { ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { Show } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { Locale } from "../util/locale"
import { useDialog } from "./dialog"
import { DialogSelect } from "./dialog-select"
import { useToast, type ToastHistoryEntry } from "./toast"

export function DialogToastHistory() {
  const toast = useToast()
  const dialog = useDialog()
  return (
    <DialogSelect
      title="Notification history"
      placeholder="Search notifications"
      emptyView={<text>No notifications yet</text>}
      options={toast.history.map((entry) => ({
        value: entry.id,
        title: entry.title || entry.message.split("\n")[0] || "Notification",
        description: entry.variant,
        footer: Locale.time(entry.time),
        searchText: `${entry.title ?? ""} ${entry.message}`,
        onSelect: () => dialog.replace(() => <NotificationDetails entry={entry} />),
      }))}
      actions={[
        {
          command: "notification.history.clear",
          title: "Clear history",
          selection: "none",
          onTrigger: () => toast.clearHistory(),
        },
      ]}
    />
  )
}

function NotificationDetails(props: { entry: ToastHistoryEntry }) {
  const theme = useTheme().surface("dialog")
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  let scroll: ScrollBoxRenderable | undefined
  const back = () => dialog.replace(() => <DialogToastHistory />)
  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "return", title: "Back to history", group: "Dialog", run: back },
      { bind: "up", title: "Scroll up", group: "Dialog", run: () => scroll?.scrollBy(-1) },
      { bind: "down", title: "Scroll down", group: "Dialog", run: () => scroll?.scrollBy(1) },
      { bind: "pageup", title: "Page up", group: "Dialog", run: () => scroll?.scrollBy(-10) },
      { bind: "pagedown", title: "Page down", group: "Dialog", run: () => scroll?.scrollBy(10) },
    ],
  }))
  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <text fg={theme.text.feedback[props.entry.variant].base}>
        {props.entry.variant} · {Locale.datetime(props.entry.time)}
      </text>
      <scrollbox ref={(value) => (scroll = value)} height={Math.max(3, Math.min(18, dimensions().height - 12))}>
        <Show when={props.entry.title}>
          <text fg={theme.text.base}>{props.entry.title}</text>
        </Show>
        <text fg={theme.text.base}>{props.entry.message}</text>
        <Show when={props.entry.truncated}>
          <text fg={theme.text.muted}>[Truncated to fit notification history]</text>
        </Show>
      </scrollbox>
      <text fg={theme.text.muted} onMouseUp={back}>
        enter back · esc close · ↑/↓ scroll
      </text>
    </box>
  )
}

import { TextAttributes } from "@opentui/core"
import { createMemo, createSignal, For } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useRoute } from "../context/route"
import { useLocal } from "../context/local"
import { useClipboard } from "../context/clipboard"
import { useToast } from "../ui/toast"
import { describeOS, describeTerminal } from "../util/system"
import { useTuiApp } from "../context/runtime"
import { useLanguage } from "../context/language"

export function DialogDebug() {
  const language = useLanguage()
  const theme = useTheme()
  const dialog = useDialog()
  const route = useRoute()
  const local = useLocal()
  const clipboard = useClipboard()
  const toast = useToast()
  const app = useTuiApp()
  const [copied, setCopied] = createSignal(false)

  dialog.setSize("large")

  const entries = createMemo(() => {
    const model = local.model.current()
    return [
      { label: language.t("tui.devtools.version"), value: `${app.version} (${app.channel})` },
      { label: language.t("tui.dialogs.date"), value: new Date().toISOString() },
      { label: language.t("tui.dialogs.os"), value: describeOS() },
      { label: language.t("command.category.terminal"), value: describeTerminal() },
      {
        label: language.t("tui.dialogs.sessionID"),
        value: route.data.type === "session" ? route.data.sessionID : language.t("tui.dialogs.notApplicable"),
      },
      {
        label: language.t("tui.dialogs.model"),
        value: model ? `${model.providerID}/${model.modelID}` : language.t("tui.dialogs.notApplicable"),
      },
    ]
  })

  const copy = () => {
    const text = entries()
      .map((entry) => `${entry.label}: ${entry.value}`)
      .join("\n")
    void clipboard
      .write(text)
      .then(() => {
        setCopied(true)
        toast.show({ message: language.t("tui.dialogs.debugCopied"), variant: "info" })
      })
      .catch(toast.error)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "return", title: language.t("tui.dialogs.copyDebug"), group: language.t("tui.dialog"), run: copy },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.default} attributes={TextAttributes.BOLD}>
          {language.t("tui.debug")}
        </text>
        <text fg={theme.text.subdued} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      {/* No click-to-copy here: releasing a mouse selection must trigger the
          global copy-on-select so users can copy a single value, e.g. the session id. */}
      <box>
        <For each={entries()}>
          {(entry) => (
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} fg={theme.text.subdued}>
                {entry.label.padEnd(10)}
              </text>
              <text fg={theme.text.default} wrapMode="word">
                {entry.value}
              </text>
            </box>
          )}
        </For>
      </box>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.subdued}>{language.t("tui.dialogs.shareDebug")}</text>
        <text onMouseUp={copy}>
          <span style={{ fg: copied() ? theme.text.feedback.success.default : theme.text.default }}>
            <b>{copied() ? language.t("tui.dialogs.copied") : language.t("tui.session.copy")}</b>{" "}
          </span>
          <span style={{ fg: theme.text.subdued }}>enter</span>
        </text>
      </box>
    </box>
  )
}

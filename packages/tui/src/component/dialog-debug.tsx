import { useLanguage } from "../context/language"
import { createMemo, createSignal, For } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { useRoute } from "../context/route"
import { useLocal } from "../context/local"
import { useClipboard } from "../context/clipboard"
import { useToast } from "../ui/toast"
import { describeOS, describeTerminal } from "../util/system"
import { useTuiApp } from "../context/runtime"
import { useNewDesigns } from "../config"

export function DialogDebug() {
  const language = useLanguage()
  const theme = useTheme()
  const dialog = useDialog()
  const route = useRoute()
  const local = useLocal()
  const clipboard = useClipboard()
  const toast = useToast()
  const app = useTuiApp()
  const newDesigns = useNewDesigns()
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
      {
        bind: newDesigns() ? "c" : "return",
        title: language.t("tui.dialogs.copyDebug"),
        group: language.t("tui.dialog"),
        run: copy,
      },
    ],
  }))

  const copyAction = () => ({
    title: copied() ? language.t("tui.dialogs.copied") : language.t("tui.session.copy"),
    key: newDesigns() ? "c" : "enter",
    color: copied() ? theme.text.feedback.success.base : undefined,
    onTrigger: copy,
  })

  return (
    <DialogLayout
      header={
        <DialogHeader
          title={language.t("tui.debug")}
          description={language.t("tui.interface.shareThisWhenReportingAnIssue")}
        />
      }
      footer={{
        actions: { primary: [copyAction()] },
        get children() {
          if (newDesigns()) return undefined
          return <text fg={theme.text.muted}>{language.t("tui.dialogs.shareDebug")}</text>
        },
      }}
    >
      {/* No click-to-copy here: releasing a mouse selection must trigger the
          global copy-on-select so users can copy a single value, e.g. the session id. */}
      <For each={entries()}>
        {(entry) => (
          <box flexDirection="row" gap={1}>
            <text flexShrink={0} fg={theme.text.muted}>
              {entry.label.padEnd(10)}
            </text>
            <text fg={theme.text.base} wrapMode="word">
              {entry.value}
            </text>
          </box>
        )}
      </For>
    </DialogLayout>
  )
}

import { useLanguage } from "../context/language"
import { createSignal, Show } from "solid-js"
import { useNewDesigns } from "../config"
import { useClipboard } from "../context/clipboard"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, useDialog, type DialogContext } from "./dialog"
import { useToast } from "./toast"

export function DialogExportResult(props: { path: string; onClose?: () => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const clipboard = useClipboard()
  const toast = useToast()
  const newDesigns = useNewDesigns()
  const [copied, setCopied] = createSignal(false)

  const close = () => {
    props.onClose?.()
    dialog.clear()
  }

  const copy = () => {
    void clipboard
      .write(props.path)
      .then(() => setCopied(true))
      .catch(toast.error)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: language.t("tui.dialogs.closeExportResult"),
        group: language.t("tui.dialog"),
        run: close,
      },
    ],
  }))

  Keymap.createLayer(() => ({
    mode: "modal",
    enabled: newDesigns(),
    commands: [{ bind: "c", title: language.t("tui.interface.copyExportPath"), group: "Dialog", run: copy }],
  }))

  return (
    <DialogLayout
      footerGap={2}
      header={<DialogHeader title={language.t("tui.dialogs.sessionExported")} onClose={close} />}
      footer={{
        actions: {
          primary: [
            copied()
              ? {
                  title: language.t("tui.interface.copied"),
                  key: "✓",
                  color: theme.text.feedback.success.base,
                  onTrigger: copy,
                }
              : { title: language.t("tui.interface.copyPath"), key: "c", onTrigger: copy },
          ],
        },
      }}
      legacyFooter={
        <box flexDirection="row" justifyContent="flex-end" gap={1}>
          <box
            paddingLeft={3}
            paddingRight={3}
            backgroundColor={theme.background.action.primary.focused}
            onMouseUp={close}
          >
            <text fg={theme.text.action.primary.focused}>{language.t("tui.dialogs.close")}</text>
          </box>
        </box>
      }
    >
      <Show when={newDesigns()} fallback={<text fg={theme.text.base}>{props.path}</text>}>
        <text fg={theme.text.base}>
          {language.t("tui.interface.savedTo")}{" "}
          <span style={{ fg: theme.text.muted, underline: true }}>{props.path}</span>
        </text>
      </Show>
    </DialogLayout>
  )
}

DialogExportResult.show = (dialog: DialogContext, path: string) =>
  new Promise<void>((resolve) => {
    dialog.replace(() => <DialogExportResult path={path} onClose={resolve} />, resolve)
  })

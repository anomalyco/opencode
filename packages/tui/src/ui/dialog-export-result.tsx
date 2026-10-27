import { createSignal, Show } from "solid-js"
import { useNewDesigns } from "../config"
import { useClipboard } from "../context/clipboard"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, useDialog, type DialogContext } from "./dialog"
import { useToast } from "./toast"

export function DialogExportResult(props: { path: string; onClose?: () => void }) {
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
        title: "Close export result",
        group: "Dialog",
        run: close,
      },
    ],
  }))

  Keymap.createLayer(() => ({
    mode: "modal",
    enabled: newDesigns(),
    commands: [{ bind: "c", title: "Copy export path", group: "Dialog", run: copy }],
  }))

  return (
    <DialogLayout
      footerGap={2}
      header={<DialogHeader title="Session exported" onClose={close} />}
      footer={{
        actions: {
          primary: [
            copied()
              ? { title: "copied", key: "✓", color: theme.text.feedback.success.base, onTrigger: copy }
              : { title: "copy path", key: "c", onTrigger: copy },
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
            <text fg={theme.text.action.primary.focused}>Close</text>
          </box>
        </box>
      }
    >
      <Show when={newDesigns()} fallback={<text fg={theme.text.base}>{props.path}</text>}>
        <text fg={theme.text.base}>
          Saved to <span style={{ fg: theme.text.muted, underline: true }}>{props.path}</span>
        </text>
      </Show>
    </DialogLayout>
  )
}

DialogExportResult.show = (dialog: DialogContext, path: string) =>
  new Promise<void>((resolve) => {
    dialog.replace(() => <DialogExportResult path={path} onClose={resolve} />, resolve)
  })

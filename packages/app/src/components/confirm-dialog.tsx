import { Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"

export function ConfirmDialog(props: {
  title: string
  message?: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const dialog = useDialog()

  const cancel = () => {
    props.onCancel()
    dialog.close()
  }

  const confirm = () => {
    props.onConfirm()
    dialog.close()
  }

  return (
    <Dialog title={props.title} class="w-full max-w-[420px] mx-auto">
      <div class="flex flex-col gap-4 p-6 pt-0">
        <Show when={props.message}>
          <p class="text-13-regular text-text-weak">{props.message}</p>
        </Show>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={cancel}>
            {props.cancelLabel}
          </Button>
          <Button type="button" variant="primary" size="large" onClick={confirm}>
            {props.confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function useConfirm() {
  const dialog = useDialog()
  const language = useLanguage()

  return (input: {
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
  }) =>
    new Promise<boolean>((resolve) => {
      dialog.show(
        () => (
          <ConfirmDialog
            title={input.title}
            message={input.message}
            confirmLabel={input.confirmLabel ?? language.t("common.delete")}
            cancelLabel={input.cancelLabel ?? language.t("common.cancel")}
            onConfirm={() => resolve(true)}
            onCancel={() => resolve(false)}
          />
        ),
        () => resolve(false),
      )
    })
}

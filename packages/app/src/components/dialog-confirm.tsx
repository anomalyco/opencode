import { Button, type ButtonProps } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

export function DialogConfirm(props: {
  title: string
  message?: JSX.Element
  confirmLabel: string
  cancelLabel: string
  confirmVariant?: ButtonProps["variant"]
  onConfirm: () => Promise<void> | void
  onCancel?: () => void
}) {
  const dialog = useDialog()
  const [store, setStore] = createStore({
    confirming: false,
  })

  const handleConfirm = async () => {
    if (store.confirming) return
    setStore("confirming", true)
    await Promise.resolve(props.onConfirm())
      .then(() => {
        dialog.close()
      })
      .finally(() => {
        setStore("confirming", false)
      })
  }

  const handleCancel = () => {
    if (store.confirming) return
    props.onCancel?.()
    dialog.close()
  }

  return (
    <Dialog title={props.title} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <Show when={props.message}>
          <div class="flex flex-col gap-1">
            <span class="text-14-regular text-text-strong">{props.message}</span>
          </div>
        </Show>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={handleCancel} disabled={store.confirming}>
            {props.cancelLabel}
          </Button>
          <Button
            variant={props.confirmVariant ?? "primary"}
            size="large"
            onClick={handleConfirm}
            disabled={store.confirming}
          >
            {props.confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

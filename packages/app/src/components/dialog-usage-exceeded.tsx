import { usePlatform } from "@/context/platform"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { JSX } from "solid-js"

export type DialogGoUpsellProps = {
  title: string
  description: JSX.Element
  link?: string
  actionLabel: string
  onClose?: (dontShowAgain?: boolean) => void
}

export function DialogUsageExceeded(props: DialogGoUpsellProps) {
  const dialog = useDialog()
  const platform = usePlatform()

  const runAction = () => {
    if (props.link) platform.openLink(props.link)
    props.onClose?.()
    dialog.close()
  }

  const dismiss = () => {
    props.onClose?.(true)
    dialog.close()
  }

  return (
    <Dialog title={props.title} description={props.description} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={dismiss}>
            Don't show again
          </Button>
          <Button variant="primary" size="large" onClick={runAction}>
            {props.actionLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

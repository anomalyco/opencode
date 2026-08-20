import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/dialog"
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
  const language = useLanguage()
  const platform = usePlatform()

  const runAction = () => {
    if (props.link) platform.openExternal(props.link)
    props.onClose?.()
    dialog.close()
  }

  const dismiss = () => {
    props.onClose?.(true)
    dialog.close()
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup title={props.title} description={props.description} />
      </DialogHeader>
      <DialogBody>
        <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
          <div class="flex justify-end gap-2">
            <Button variant="ghost" size="large" onClick={dismiss}>
              {language.t("dialog.usageExceeded.dontShowAgain")}
            </Button>
            <Button variant="contrast" size="large" onClick={runAction}>
              {props.actionLabel}
            </Button>
          </div>
        </div>
      </DialogBody>
    </Dialog>
  )
}

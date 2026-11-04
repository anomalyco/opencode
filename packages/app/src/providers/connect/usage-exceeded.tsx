import { usePlatform } from "@/runtime/platform/platform"
import { useLanguage } from "@/runtime/i18n/language"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { children, JSX } from "solid-js"

export type DialogGoUpsellProps = {
  title: string
  description: JSX.Element
  link?: string
  actionLabel: string
  /** Art above the title, under the close button. */
  hero?: JSX.Element
  onClose?: (dontShowAgain?: boolean) => void
}

export function DialogUsageExceeded(props: DialogGoUpsellProps) {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const hero = children(() => props.hero)

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
    <Dialog
      fit
      class={
        hero()
          ? "relative [&_[data-slot=dialog-close-button]]:absolute [&_[data-slot=dialog-close-button]]:right-4 [&_[data-slot=dialog-close-button]]:top-4"
          : undefined
      }
    >
      {hero()}
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

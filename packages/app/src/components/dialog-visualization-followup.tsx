import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useLanguage } from "@/context/language"

export type VisualizationFollowupDialogResult = "confirmed" | "cancelled"

type DialogVisualizationFollowupProps = {
  title?: string
  prompt: string
  onResult: (result: VisualizationFollowupDialogResult) => void
  close?: () => void
}

export function createVisualizationFollowupDialogActions(input: {
  onResult: (result: VisualizationFollowupDialogResult) => void
  close?: () => void
}) {
  let settled = false

  const settle = (result: VisualizationFollowupDialogResult) => {
    if (settled) return
    settled = true
    input.onResult(result)
    input.close?.()
  }

  return {
    confirm: () => settle("confirmed"),
    cancel: () => settle("cancelled"),
  }
}

export function DialogVisualizationFollowup(props: DialogVisualizationFollowupProps) {
  const language = useLanguage()
  const actions = createVisualizationFollowupDialogActions({
    onResult: props.onResult,
    close: props.close,
  })

  return (
    <Dialog title={<span>{props.title}</span>}>
      <div class="flex flex-col gap-4 px-6 pb-4">
        <div class="whitespace-pre-wrap break-words text-14-regular text-text-base">{props.prompt}</div>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={actions.cancel}>
            {language.t("common.cancel")}
          </Button>
          <Button type="button" variant="primary" size="large" onClick={actions.confirm}>
            {language.t("ui.promptInput.send")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

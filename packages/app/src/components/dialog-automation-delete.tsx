import { DialogConfirm } from "@/components/dialog-confirm"
import { useLanguage } from "@/context/language"
import type { Automation } from "@opencode-ai/sdk/v2/client"

export function DialogAutomationDelete(props: {
  automation: Automation
  onDelete: (automation: Automation) => Promise<void>
}) {
  const language = useLanguage()

  return (
    <DialogConfirm
      title={language.t("automations.delete.title")}
      message={language.t("automations.delete.confirm", { name: props.automation.name })}
      confirmLabel={language.t("automations.delete.button")}
      cancelLabel={language.t("common.cancel")}
      onConfirm={() => props.onDelete(props.automation)}
    />
  )
}

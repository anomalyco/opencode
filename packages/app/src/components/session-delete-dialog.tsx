import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { DialogFooter, DialogHeader, DialogTitleGroup, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"

export function SessionDeleteDialog(props: { name: string; onDelete: () => Promise<boolean> }) {
  const dialog = useDialog()
  const language = useLanguage()
  return (
    <DialogV2 fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("session.delete.title")}
          description={language.t("session.delete.confirm", { name: props.name })}
        />
      </DialogHeader>
      <DialogFooter>
        <ButtonV2 variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </ButtonV2>
        <ButtonV2
          variant="danger"
          onClick={() => {
            void props.onDelete().then((ok) => { if (ok) dialog.close() })
          }}
        >
          {language.t("session.delete.button")}
        </ButtonV2>
      </DialogFooter>
    </DialogV2>
  )
}

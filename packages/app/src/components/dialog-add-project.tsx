import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { DialogCreateProject } from "./dialog-create-project"

export function DialogAddProject(props: { onResolve: (path: string | string[]) => void; openExisting: () => void }) {
  const dialog = useDialog()
  const language = useLanguage()

  function createNew() {
    dialog.show(() => <DialogCreateProject onSelect={(path) => props.onResolve(path)} />)
  }

  function openExisting() {
    dialog.close()
    props.openExisting()
  }

  return (
    <Dialog title={language.t("dialog.add.title")} class="w-full max-w-[400px] mx-auto">
      <div class="flex flex-col gap-2 p-6 pt-0">
        <button
          type="button"
          data-component="add-project-option"
          onClick={createNew}
          class="flex items-center gap-3 w-full rounded-lg px-4 py-3 text-left transition-colors bg-surface-base hover:bg-surface-base-hover border border-border-base hover:border-border-strong cursor-default"
        >
          <div class="flex items-center justify-center size-8 rounded-md bg-surface-raised-base shrink-0">
            <Icon name="folder-add-left" size="small" class="text-icon-base" />
          </div>
          <div class="flex flex-col gap-0.5 min-w-0">
            <span class="text-14-medium text-text-strong">{language.t("dialog.add.create")}</span>
            <span class="text-12-regular text-text-weak">{language.t("dialog.add.create.description")}</span>
          </div>
        </button>

        <button
          type="button"
          data-component="add-project-option"
          onClick={openExisting}
          class="flex items-center gap-3 w-full rounded-lg px-4 py-3 text-left transition-colors bg-surface-base hover:bg-surface-base-hover border border-border-base hover:border-border-strong cursor-default"
        >
          <div class="flex items-center justify-center size-8 rounded-md bg-surface-raised-base shrink-0">
            <Icon name="square-arrow-top-right" size="small" class="text-icon-base" />
          </div>
          <div class="flex flex-col gap-0.5 min-w-0">
            <span class="text-14-medium text-text-strong">{language.t("dialog.add.open")}</span>
            <span class="text-12-regular text-text-weak">{language.t("dialog.add.open.description")}</span>
          </div>
        </button>
      </div>
    </Dialog>
  )
}

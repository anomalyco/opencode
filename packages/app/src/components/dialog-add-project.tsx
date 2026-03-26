import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { DialogCreateProject } from "./dialog-create-project"
import { DialogImportPennylane } from "./dialog-import-pennylane"

function PennylaneLogo(props: { class?: string }) {
  return (
    <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" class={props.class}>
      <circle cx="100" cy="100" r="88" stroke="#3C5068" stroke-width="24" fill="none" />
      <circle cx="82" cy="100" r="36" fill="#2CED71" />
      <circle cx="118" cy="100" r="36" fill="#0A7B5A" />
      <path d="M100 70.72C107.55 77.02 112.36 86.42 112.36 97C112.36 107.58 107.55 116.98 100 123.28C92.45 116.98 87.64 107.58 87.64 97C87.64 86.42 92.45 77.02 100 70.72Z" fill="#0A7B5A" opacity="0.6" />
    </svg>
  )
}

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

  function importFromPennylane() {
    dialog.show(() => (
      <DialogImportPennylane
        onImport={(entities) => {
          const paths = entities.map((e) => e.name)
          props.onResolve(paths)
        }}
      />
    ))
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

        <button
          type="button"
          data-component="add-project-option"
          onClick={importFromPennylane}
          class="flex items-center gap-3 w-full rounded-lg px-4 py-3 text-left transition-colors bg-surface-base hover:bg-surface-base-hover border border-border-base hover:border-border-strong cursor-default"
        >
          <div class="flex items-center justify-center size-8 rounded-md bg-surface-raised-base shrink-0">
            <PennylaneLogo class="size-5" />
          </div>
          <div class="flex flex-col gap-0.5 min-w-0">
            <span class="text-14-medium text-text-strong">Import from Pennylane</span>
            <span class="text-12-regular text-text-weak">Add clients or suppliers from your accounting</span>
          </div>
        </button>
      </div>
    </Dialog>
  )
}

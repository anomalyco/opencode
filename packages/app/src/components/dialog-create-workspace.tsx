import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { type LocalProject } from "@/context/layout"

export function DialogCreateWorkspace(props: {
  project: LocalProject
  onCreate: (input: { name?: string; branch?: string; baseBranch?: string }) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()

  const [store, setStore] = createStore({
    name: "",
    branch: "",
    baseBranch: props.project.worktreeSettings?.baseBranch ?? "",
  })

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    props.onCreate({
      name: store.name.trim() || undefined,
      branch: store.branch.trim() || undefined,
      baseBranch: store.baseBranch.trim() || undefined,
    })
    dialog.close()
  }

  return (
    <Dialog title={language.t("dialog.workspace.create.title")} class="w-full max-w-[480px] mx-auto">
      <form onSubmit={handleSubmit} class="flex flex-col gap-6 p-6 pt-0">
        <div class="flex flex-col gap-4">
          <TextField
            autofocus
            type="text"
            label={language.t("dialog.workspace.create.name")}
            placeholder={language.t("dialog.workspace.create.name.placeholder")}
            value={store.name}
            onChange={(v) => setStore("name", v)}
          />
          <TextField
            type="text"
            label={language.t("dialog.workspace.create.branch")}
            placeholder={language.t("dialog.workspace.create.branch.placeholder")}
            value={store.branch}
            onChange={(v) => setStore("branch", v)}
          />
          <TextField
            type="text"
            label={language.t("dialog.workspace.create.baseBranch")}
            placeholder={language.t("dialog.workspace.create.baseBranch.placeholder")}
            value={store.baseBranch}
            onChange={(v) => setStore("baseBranch", v)}
          />
        </div>
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large">
            {language.t("workspace.new")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

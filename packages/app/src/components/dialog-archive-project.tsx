import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useMutation } from "@tanstack/solid-query"
import { createMemo } from "solid-js"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import type { LocalProject } from "@/context/layout"
import { displayName, errorMessage } from "@/pages/layout/helpers"
import { showToast } from "@/utils/toast"
import type { ServerConnection } from "@/context/server"

export function DialogArchiveProject(props: { project: LocalProject; server: ServerConnection.Any }) {
  const dialog = useDialog()
  const global = useGlobal()
  const language = useLanguage()
  const serverCtx = createMemo(() => global.ensureServerCtx(props.server))
  const serverSDK = () => serverCtx().sdk
  const name = createMemo(() => displayName(props.project))

  const archiveMutation = useMutation(() => ({
    mutationFn: async () => {
      const sdk = serverSDK()
      // The local store can briefly lag behind the server when a project is
      // freshly created (the per-directory event payload arrives asynchronously).
      // Resolve the id by worktree if needed so the archive action always works.
      let projectID = props.project.id
      if (!projectID) {
        const list = await sdk.client.project.list()
        const match = (list.data ?? []).find((p) => p.worktree === props.project.worktree)
        projectID = match?.id
      }
      if (!projectID) throw new Error("Project has no id")
      await sdk.client.project.archive({
        projectID,
        directory: props.project.worktree,
      })
    },
    onSuccess: () => {
      serverCtx().queryClient.invalidateQueries({ queryKey: [serverSDK().scope, "project"] })
      serverCtx().queryClient.invalidateQueries({ queryKey: [serverSDK().scope, "project", "archived"] })
      dialog.close()
    },
    onError: (error) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(error, language.t("common.requestFailed")),
      }),
  }))

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (archiveMutation.isPending) return
    archiveMutation.mutate()
  }

  return (
    <Dialog
      title={language.t("dialog.project.archive.title")}
      description={language.t("dialog.project.archive.description", { name: name() })}
      fit
      class="w-full max-w-[480px] mx-auto"
    >
      <form onSubmit={handleSubmit} class="flex justify-end gap-2 pl-6 pr-6 pb-4">
        <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
          {language.t("dialog.project.archive.cancel")}
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="large"
          disabled={archiveMutation.isPending}
          data-action="archive-project-confirm"
        >
          {archiveMutation.isPending ? language.t("common.loading") : language.t("dialog.project.archive.confirm")}
        </Button>
      </form>
    </Dialog>
  )
}

import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { useMutation } from "@tanstack/solid-query"
import { createStore, produce } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { validateSessionRename } from "./dialog-rename-session-form"

export function DialogRenameSession(props: { sessionID: string; title: string; directory: string }) {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const [store, setStore] = createStore({ title: props.title, error: "" })

  const rename = useMutation(() => ({
    mutationFn: async () => {
      const next = validateSessionRename({ title: store.title, currentTitle: props.title })
      if (next.error) {
        setStore("error", language.t(next.error))
        return
      }
      if (!next.result) {
        dialog.close()
        return
      }
      await serverSDK().client.session.update({
        directory: props.directory,
        sessionID: props.sessionID,
        title: next.result.title,
      })
      const [, setDirectoryStore] = serverSync().child(props.directory)
      setDirectoryStore(
        produce((draft) => {
          const index = draft.session.findIndex((session) => session.id === props.sessionID)
          if (index !== -1) draft.session[index].title = next.result.title
        }),
      )
      dialog.close()
    },
    onError: (err) => {
      showToast({
        variant: "error",
        title: language.t("dialog.session.rename.failed.title"),
        description: err instanceof Error ? err.message : String(err),
      })
    },
  }))

  function submit(e: SubmitEvent) {
    e.preventDefault()
    if (rename.isPending) return
    setStore("error", "")
    rename.mutate()
  }

  return (
    <Dialog title={language.t("dialog.session.rename.title")} class="w-full max-w-[420px] mx-auto">
      <form onSubmit={submit} class="flex flex-col gap-5 p-6 pt-0">
        <TextField
          autofocus
          type="text"
          label={language.t("dialog.session.rename.name")}
          value={store.title}
          onChange={(value) => {
            setStore("title", value)
            if (store.error) setStore("error", "")
          }}
          error={store.error || undefined}
        />
        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={rename.isPending}>
            {rename.isPending ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

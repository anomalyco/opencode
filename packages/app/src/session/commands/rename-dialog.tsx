import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode/ui/dialog"
import { TextField } from "@opencode/ui/text-field"
import { showToast } from "@/shell/notifications/toast"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { formatServerError } from "@/runtime/server/errors"
import { sessionTitle } from "@/session/title"

export function DialogRename(props: { sessionID: string }) {
  const dialog = useDialog()
  const data = useData()
  const serverSDK = useServerSDK()
  const language = useLanguage()
  const [state, setState] = createStore({
    title: sessionTitle(data.session.get(props.sessionID)?.title) ?? "",
    pending: false,
  })

  const save = (event: SubmitEvent) => {
    event.preventDefault()
    const title = state.title.trim()
    if (!title || state.pending) return
    setState("pending", true)
    void serverSDK.api.session
      .update({ sessionID: props.sessionID, title })
      .then(() => {
        const current = data.session.get(props.sessionID)
        if (current) data.session.remember({ ...current, title })
        dialog.close()
      })
      .catch((error) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: formatServerError(error, language.t, language.t("common.requestFailed")),
        })
      })
      .finally(() => setState("pending", false))
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitle>{language.t("command.session.rename")}</DialogTitle>
      </DialogHeader>
      <form onSubmit={save}>
        <DialogBody class="px-4">
          <TextField
            autofocus
            label={language.t("dialog.rename.title.label")}
            hideLabel
            placeholder={language.t("dialog.rename.title.placeholder")}
            value={state.title}
            onChange={(value) => setState("title", value)}
            disabled={state.pending}
          />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="contrast" disabled={state.pending || !state.title.trim()}>
            {state.pending ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  )
}

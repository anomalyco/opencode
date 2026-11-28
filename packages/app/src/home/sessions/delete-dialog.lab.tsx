import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { sessionTitle } from "@/session/title"

type Args = { sessionTitle: string; deleting: boolean }

function DeleteSessionStory(props: Args) {
  const dialog = useDialog()

  const language = useLanguage()

  const [store, setStore] = createStore({ status: "Session active" })

  const open = () =>
    void dialog.show(() => (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("session.delete.title")}
            description={language.t("session.delete.confirm", {
              name: sessionTitle(props.sessionTitle || undefined) ?? language.t("command.session.new"),
            })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" autofocus disabled={props.deleting} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={props.deleting}
            onClick={() => {
              setStore("status", "Session deleted")
              dialog.close()
            }}
          >
            {language.t("session.delete.button")}
          </Button>
        </DialogFooter>
      </Dialog>
    ))

  onMount(open)

  return (
    <div class="flex flex-col items-start gap-3">
      <Button variant="neutral" onClick={open}>
        Open delete session dialog
      </Button>
      <p role="status">{store.status}</p>
    </div>
  )
}

export default {
  title: "App/Dialogs/Delete Session",
  id: "app-dialog-delete-session",
  args: { sessionTitle: "Refactor the dialog primitives", deleting: false } satisfies Args,
  render: (args: Args) => <DeleteSessionStory {...args} />,
}

export const Default = {}

export const Untitled = { args: { sessionTitle: "" } }

export const Deleting = { args: { deleting: true } }

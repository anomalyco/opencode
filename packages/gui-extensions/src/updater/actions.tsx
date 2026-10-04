import type { JSX } from "solid-js"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { showToast } from "@opencode/ui/toast"
import { App, Dialogs, type Context, type RemoteClient } from "../sdk"
import type { Updater } from "./contract"

type Client = RemoteClient<typeof Updater.spec>

/** Restarts into the staged update. A beta build moving to stable confirms the installer download first. */
export function install(ctx: Context, client: Client) {
  const download = () =>
    client.install().catch((error: unknown) => {
      showToast({
        title: ctx.t("common.requestFailed"),
        description: error instanceof Error && error.message ? error.message : ctx.t("common.requestFailed"),
      })
    })
  const state = client.state()
  if (state?.status !== "download-required") {
    void download()
    return
  }
  ctx.use(Dialogs).show(() => <DialogStableDownload ctx={ctx} version={state.version} download={download} />)
}

export async function check(ctx: Context, client: Client) {
  const state = await client.check()
  if (state.status === "download-required") {
    install(ctx, client)
    return
  }
  if (state.status === "up-to-date") {
    showToast({
      variant: "success",
      // The toast renders the icon under its own owner.
      icon: (() => <Icon name="circle-check" />) as unknown as JSX.Element,
      title: ctx.t("toast.latest.title"),
      description: ctx.t("toast.latest.description", { version: ctx.use(App).version ?? "" }),
    })
  }
  if (state.status === "error") {
    showToast({ title: ctx.t("common.requestFailed"), description: state.message })
  }
}

function DialogStableDownload(props: { ctx: Context; version: string; download: () => Promise<void> }) {
  const ctx = props.ctx
  const dialog = useDialog()
  const download = () => {
    dialog.close()
    void props.download()
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={ctx.t("migration.title")}
          description={ctx.t("migration.description", { version: props.version })}
        />
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={() => dialog.close()}>
          {ctx.t("common.cancel")}
        </Button>
        <Button type="button" variant="contrast" autofocus onClick={download}>
          {ctx.t("action.download")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

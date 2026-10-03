import { Button } from "@opencode/ui/button"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { showToast } from "@opencode/ui/toast"
import type { DialogHandle, IpcClient, SetupContext } from "../sdk"
import type { Updater } from "./contract"
import type definition from "./index"

type Client = IpcClient<typeof Updater.spec>

type Context = SetupContext<typeof definition>

/** Restarts into the staged update. A beta build moving to stable confirms the installer download first. */
export function install(ctx: Context, client: Client) {
  const download = () =>
    client.install().catch((cause: unknown) => {
      showToast({
        title: ctx.t("common.requestFailed"),
        description: cause instanceof Error && cause.message ? cause.message : ctx.t("common.requestFailed"),
      })
    })

  const state = client.state()

  if (state?.status !== "download-required") {
    void download()

    return
  }

  ctx.dialogs.open(
    (dialog) => <DialogStableDownload ctx={ctx} dialog={dialog} version={state.version} download={download} />,
    { replace: true },
  )
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
      icon: () => <Icon name="circle-check" />,
      title: ctx.t("toast.latest.title"),
      description: ctx.t("toast.latest.description", { version: ctx.build.version }),
    })
  }

  if (state.status === "error") {
    showToast({ title: ctx.t("common.requestFailed"), description: state.message })
  }
}

function DialogStableDownload(props: {
  ctx: Context
  dialog: DialogHandle
  version: string
  download: () => Promise<void>
}) {
  const ctx = props.ctx

  const download = () => {
    props.dialog.close()
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
        <Button type="button" variant="neutral" onClick={() => props.dialog.close()}>
          {ctx.t("common.cancel")}
        </Button>
        <Button type="button" variant="contrast" autofocus onClick={download}>
          {ctx.t("action.download")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

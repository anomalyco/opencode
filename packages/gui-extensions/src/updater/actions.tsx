import { Button } from "@opencode/ui/button"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import { showToast, toaster } from "@opencode/ui/toast"
import type { DialogHandle, IpcClient, SetupContext } from "../sdk"
import type { Updater } from "./contract"
import type definition from "./index"

type Client = IpcClient<typeof Updater.spec>

type Context = SetupContext<typeof definition>

/** Restarts into the staged update. A beta build moving to stable confirms the installer download first. */
export function install(ctx: Context, client: Client) {
  const download = () => client.install().catch((cause: unknown) => requestFailed(ctx, cause))

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
  const checking = showToast({ variant: "loading", title: ctx.t("action.checking") })

  const state = await client
    .check({ signal: ctx.signal })
    .catch((cause: unknown) => requestFailed(ctx, cause))
    .finally(() => toaster.dismiss(checking))

  if (!state || ctx.signal.aborted) return

  // Every settled check says what happened; only an install already underway stays quiet.
  switch (state.status) {
    case "download-required":
      return install(ctx, client)
    case "up-to-date":
      return void showToast({
        variant: "success",
        icon: () => <Icon name="circle-check" />,
        title: ctx.t("toast.latest.title"),
        description: ctx.t("toast.latest.description", { version: ctx.build.version }),
      })
    case "ready":
      return void showToast({
        title: ctx.t("dialog.ready.title"),
        description: ctx.t("dialog.ready.message", { version: state.version }),
        persistent: true,
        actions: [
          { label: ctx.t("dialog.restart"), variant: "primary", onClick: () => install(ctx, client) },
          { label: ctx.t("dialog.later"), variant: "secondary", onClick: "dismiss" },
        ],
      })
    case "error":
      return void showToast({ title: ctx.t("common.requestFailed"), description: state.message })
  }
}

function requestFailed(ctx: Context, cause: unknown) {
  if (ctx.signal.aborted) return

  showToast({
    title: ctx.t("common.requestFailed"),
    description: cause instanceof Error && cause.message ? cause.message : undefined,
  })
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

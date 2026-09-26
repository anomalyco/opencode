import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { formatServerError } from "@/runtime/server/errors"
import { showToast } from "@/shell/notifications/toast"

export function useUpdaterInstall() {
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const download = () =>
    platform.updater?.install().catch((error) => {
      showToast({
        title: language.t("common.requestFailed"),
        description: formatServerError(error, language.t, language.t("common.requestFailed")),
      })
    })

  return () => {
    const state = platform.updater?.state()
    if (state?.status !== "download-required") {
      void download()
      return
    }
    void dialog.show(() => <DialogStableDownload version={state.version} download={download} />)
  }
}

export function DialogStableDownload(props: { version: string; download: () => Promise<void> | undefined }) {
  const dialog = useDialog()
  const language = useLanguage()
  const download = () => {
    dialog.close()
    void props.download()
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("settings.updates.migration.title")}
          description={language.t("settings.updates.migration.description", { version: props.version })}
        />
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="neutral" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button type="button" variant="contrast" autofocus onClick={download}>
          {language.t("settings.updates.action.download")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

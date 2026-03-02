import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

export function DeleteBranchDialog() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()

  const pr = createMemo(() => sync.data.vcs?.pr)

  const [store, setStore] = createStore({
    submitting: false,
  })

  const handleDelete = async () => {
    const p = pr()
    if (!p?.headRefName || store.submitting) return

    setStore("submitting", true)

    try {
      await sdk.client.vcs.pr.deleteBranch({
        directory: sdk.directory,
        prDeleteBranchInput: { branch: p.headRefName },
      })

      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("pr.toast.branch_deleted"),
      })
      dialog.close()
    } catch {
      showToast({
        variant: "error",
        icon: "circle-x",
        title: language.t("pr.error.delete_branch_failed"),
      })
    } finally {
      setStore("submitting", false)
    }
  }

  return (
    <Dialog title={language.t("pr.delete.title")} fit>
      <div class="flex flex-col gap-4 px-5 pb-5">
        <div class="flex items-start gap-2 rounded-md border border-border-critical-base bg-surface-critical-weak px-3 py-2.5">
          <Icon name="warning" size="small" class="text-icon-critical-base shrink-0 mt-px" />
          <div class="flex flex-col gap-1.5">
            <div class="flex items-center gap-1.5 text-13-regular text-text-strong">
              <Icon name="branch" size="small" class="shrink-0" />
              <span class="font-mono">{pr()?.headRefName}</span>
            </div>
            <span class="text-12-regular text-text-weak">{language.t("pr.delete.warning")}</span>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            class="!bg-surface-critical-strong !text-text-invert-strong !border-surface-critical-strong hover:!opacity-90"
            onClick={handleDelete}
            disabled={store.submitting}
          >
            {store.submitting ? language.t("pr.delete.submitting") : language.t("pr.delete.submit")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

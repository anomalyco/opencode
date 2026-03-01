import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { resolveApiErrorMessage } from "@/utils/pr-errors"

type MergeStrategy = "squash" | "merge" | "rebase"

const STRATEGIES: MergeStrategy[] = ["squash", "merge", "rebase"]

export function MergePrDialog() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()

  const pr = createMemo(() => sync.data.vcs?.pr)

  const hasConflict = createMemo(() => pr()?.mergeable === "CONFLICTING")
  const checksFailing = createMemo(() => pr()?.checksState === "FAILURE")

  const [store, setStore] = createStore({
    strategy: "squash" as MergeStrategy,
    deleteBranch: true,
    submitting: false,
    error: undefined as string | undefined,
  })

  const strategyLabel = (s: MergeStrategy) => {
    const key = `pr.merge.strategy.${s}` as const
    return language.t(key as Parameters<typeof language.t>[0])
  }

  const handleSubmit = async () => {
    if (store.submitting || hasConflict()) return
    setStore("submitting", true)
    setStore("error", undefined)

    try {
      await sdk.client.vcs.pr.merge({
        directory: sdk.directory,
        prMergeInput: {
          strategy: store.strategy,
          deleteBranch: store.deleteBranch,
        },
      })

      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("pr.toast.merged"),
      })
      dialog.close()
    } catch (e: unknown) {
      if (import.meta.env.DEV) console.error("PR merge error:", e)
      setStore("error", resolveApiErrorMessage(e, "Failed to merge PR", (k) => language.t(k as Parameters<typeof language.t>[0])))
    } finally {
      setStore("submitting", false)
    }
  }

  return (
    <Dialog title={language.t("pr.merge.title")}>
      <div class="flex flex-col gap-4 px-5 pb-5">
        {/* PR info */}
        <div class="flex items-center gap-1.5 text-12-regular text-text-weak">
          <Icon name="branch" size="small" class="text-icon-weak shrink-0" />
          <span class="truncate">{pr()?.headRefName}</span>
          <span class="shrink-0">&rarr;</span>
          <span class="truncate">{pr()?.baseRefName}</span>
        </div>

        {/* Conflict warning */}
        <Show when={hasConflict()}>
          <div class="flex items-start gap-2 rounded-md border border-border-critical-base bg-surface-critical-weak px-3 py-2.5">
            <Icon name="circle-x" size="small" class="text-icon-critical-base shrink-0 mt-px" />
            <span class="flex-1 text-13-regular text-text-danger">{language.t("pr.merge.conflict")}</span>
          </div>
        </Show>

        {/* Checks failing warning */}
        <Show when={checksFailing() && !hasConflict()}>
          <div class="flex items-start gap-2 rounded-md border border-border-warning-base bg-surface-warning-weak px-3 py-2.5">
            <Icon name="warning" size="small" class="text-icon-warning-base shrink-0 mt-px" />
            <span class="flex-1 text-13-regular text-text-strong">{language.t("pr.merge.checks_failing")}</span>
          </div>
        </Show>

        {/* Strategy selector */}
        <div class="flex flex-col gap-1.5">
          <label class="text-12-medium text-text-strong">{language.t("pr.merge.strategy")}</label>
          <Select
            options={STRATEGIES}
            current={store.strategy}
            onSelect={(v) => setStore("strategy", (v as MergeStrategy) ?? "squash")}
            variant="secondary"
            triggerVariant="settings"
            triggerStyle={{
              width: "100%",
              "justify-content": "space-between",
              background: "var(--input-base)",
              border: "1px solid var(--border-weak-base)",
              "border-radius": "var(--radius-md)",
            }}
          >
            {(item) => <span>{item ? strategyLabel(item) : ""}</span>}
          </Select>
        </div>

        {/* Delete branch checkbox */}
        <Switch checked={store.deleteBranch} onChange={(checked) => setStore("deleteBranch", checked)}>
          {language.t("pr.merge.delete_branch")}
        </Switch>

        {/* Error display */}
        <Show when={store.error}>
          <div class="flex items-start gap-2 rounded-md border border-border-critical-base bg-surface-critical-weak px-3 py-2.5">
            <Icon name="circle-x" size="small" class="text-icon-critical-base shrink-0 mt-px" />
            <span class="flex-1 text-13-regular text-text-danger whitespace-pre-wrap break-words">{store.error}</span>
          </div>
        </Show>

        {/* Actions */}
        <div class="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={store.submitting || hasConflict()}
          >
            {store.submitting ? language.t("pr.merge.submitting") : language.t("pr.merge.submit")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

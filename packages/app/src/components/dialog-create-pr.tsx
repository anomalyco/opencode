import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { resolveApiErrorMessage } from "@/utils/pr-errors"

export function CreatePrDialog() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const language = useLanguage()

  const vcs = createMemo(() => sync.data.vcs)
  const branch = createMemo(() => vcs()?.branch ?? "")
  const defaultBranch = createMemo(() => vcs()?.defaultBranch ?? "main")
  const dirty = createMemo(() => vcs()?.dirty)

  const isPushed = createMemo(() => {
    const current = branch()
    const branches = vcs()?.branches ?? []
    return branches.includes(current)
  })

  const branchTitle = createMemo(() => {
    const b = branch()
    if (!b) return ""
    return b.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  })

  const baseOptions = createMemo(() => {
    const remote = vcs()?.branches
    if (remote && remote.length > 0) return remote
    return [defaultBranch()]
  })

  const [store, setStore] = createStore({
    title: branchTitle(),
    body: "",
    base: defaultBranch(),
    draft: false,
    submitting: false,
    committing: false,
    commitMessage: branchTitle(),
    showCommitInput: false,
    error: undefined as string | undefined,
  })

  const [titleEdited, setTitleEdited] = createSignal(false)
  const [baseEdited, setBaseEdited] = createSignal(false)

  createEffect(() => {
    const t = branchTitle()
    if (t && !titleEdited()) {
      setStore("title", t)
      setStore("commitMessage", t)
    }
  })

  createEffect(() => {
    const b = defaultBranch()
    if (b && !baseEdited()) {
      setStore("base", b)
    }
  })

  const handleCommit = async () => {
    if (!store.commitMessage.trim() || store.committing) return
    setStore("committing", true)
    setStore("error", undefined)

    try {
      await sdk.client.vcs.commit({
        directory: sdk.directory,
        vcsCommitInput: {
          message: store.commitMessage.trim(),
        },
      })

      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("pr.commit.success"),
      })
      setStore("showCommitInput", false)
    } catch (e: unknown) {
      const err = (e as { error?: { message?: string } })?.error ?? e
      setStore("error", (err as { message?: string })?.message ?? "Commit failed")
    } finally {
      setStore("committing", false)
    }
  }

  const handleSubmit = async () => {
    if (!store.title.trim() || store.submitting) return
    setStore("submitting", true)
    setStore("error", undefined)

    try {
      await sdk.client.vcs.pr.create({
        directory: sdk.directory,
        prCreateInput: {
          title: store.title.trim(),
          body: store.body.trim() || store.title.trim(),
          base: store.base || undefined,
          draft: store.draft,
        },
      })

      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("pr.toast.created"),
      })
      dialog.close()
    } catch (e: unknown) {
      if (import.meta.env.DEV) console.error("PR creation error:", e)
      setStore("error", resolveApiErrorMessage(e, "Failed to create PR", (k) => language.t(k as Parameters<typeof language.t>[0])))
    } finally {
      setStore("submitting", false)
    }
  }

  return (
    <Dialog title={language.t("pr.create.title")}>
      <div class="flex flex-col gap-4 px-5 pb-5">
        {/* Branch flow indicator */}
        <div class="flex items-center gap-1.5 text-12-regular text-text-weak">
          <Icon name="branch" size="small" class="text-icon-weak shrink-0" />
          <span class="truncate">{branch()}</span>
          <span class="shrink-0">&rarr;</span>
          <span class="truncate">{store.base || defaultBranch()}</span>
        </div>

        <Show when={(dirty() ?? 0) > 0}>
          <div class="flex flex-col gap-2.5 rounded-md border border-border-warning-base bg-surface-warning-weak px-3 py-2.5">
            <div class="flex items-center gap-2">
              <Icon name="warning" size="small" class="text-icon-warning-base shrink-0" />
              <span class="flex-1 text-13-regular text-text-strong">
                {language.t("pr.commit.warning", { count: String(dirty()) })}
              </span>
              <Show when={!store.showCommitInput}>
                <Button
                  variant="secondary"
                  class="shrink-0 h-7 px-2.5 text-12-medium"
                  onClick={() => setStore("showCommitInput", true)}
                >
                  {language.t("pr.commit.action")}
                </Button>
              </Show>
            </div>
            <Show when={store.showCommitInput}>
              <div class="flex gap-2">
                <TextField
                  value={store.commitMessage}
                  onInput={(e) => setStore("commitMessage", e.currentTarget.value)}
                  placeholder={language.t("pr.commit.placeholder")}
                  class="flex-1"
                  autofocus
                  onKeyDown={(e: KeyboardEvent) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      handleCommit()
                    }
                  }}
                />
                <Button
                  variant="primary"
                  class="shrink-0 h-8"
                  onClick={handleCommit}
                  disabled={!store.commitMessage.trim() || store.committing}
                >
                  {store.committing ? language.t("pr.commit.committing") : language.t("pr.commit.submit")}
                </Button>
              </div>
            </Show>
          </div>
        </Show>
        <div class="flex flex-col gap-1.5">
          <label class="text-12-medium text-text-strong">{language.t("pr.create.field.title")}</label>
          <TextField
            value={store.title}
            onInput={(e) => {
              setTitleEdited(true)
              setStore("title", e.currentTarget.value)
            }}
            autofocus
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-12-medium text-text-strong">{language.t("pr.create.field.body")}</label>
          <TextField
            multiline
            value={store.body}
            onInput={(e) => setStore("body", e.currentTarget.value)}
            placeholder={language.t("pr.create.field.body.placeholder")}
            style={{ "min-height": "80px" }}
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-12-medium text-text-strong">{language.t("pr.create.field.base")}</label>
          <Select
            options={baseOptions()}
            current={store.base}
            onSelect={(v) => {
              setBaseEdited(true)
              setStore("base", v ?? defaultBranch())
            }}
            variant="secondary"
            triggerVariant="settings"
            triggerStyle={{
              width: "100%",
              "justify-content": "space-between",
              background: "var(--input-base)",
              border: "1px solid var(--border-weak-base)",
              "border-radius": "var(--radius-md)",
            }}
          />
        </div>
        <Show when={store.error}>
          <div class="flex items-start gap-2 rounded-md border border-border-critical-base bg-surface-critical-weak px-3 py-2.5">
            <Icon name="circle-x" size="small" class="text-icon-critical-base shrink-0 mt-px" />
            <span class="flex-1 text-13-regular text-text-danger whitespace-pre-wrap break-words">{store.error}</span>
          </div>
        </Show>
        <div class="flex items-center gap-2">
          <Switch checked={store.draft} onChange={(checked) => setStore("draft", checked)}>
            {language.t("pr.create.field.draft")}
          </Switch>
          <div class="flex-1" />
          <Button variant="secondary" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!store.title.trim() || store.submitting}>
            {store.submitting
              ? language.t("pr.create.submitting")
              : isPushed()
                ? language.t("pr.create.submit")
                : language.t("pr.create.submitPush")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Icon } from "@opencode-ai/ui/icon"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"

const err = (value: unknown) => {
  if (typeof value === "object" && value && "error" in value) {
    const next = value as { error?: { message?: string } }
    if (next.error?.message) return next.error.message
  }
  if (value instanceof Error) return value.message
  return "Request failed"
}

export function CommitDialog() {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()
  const sync = useSync()

  const [store, setStore] = createStore({
    status: "loading" as "loading" | "ready" | "error",
    branch: "",
    staged: 0,
    unstaged: 0,
    hasRemote: false,
    githubAvailable: false,
    githubAuthenticated: false,
    files: 0,
    added: 0,
    removed: 0,
    includeUnstaged: true,
    action: "commit" as "commit" | "push" | "pr",
    message: "",
    submitting: false,
    error: undefined as string | undefined,
  })

  onMount(() => {
    Promise.all([
      sdk.client.vcs.get({ directory: sdk.directory }),
      sdk.client.file.status({ directory: sdk.directory }),
    ])
      .then(([vcs, files]) => {
        const info = vcs.data
        const list = files.data ?? []
        const branch = info?.branch ?? sync.data.vcs?.branch ?? ""
        const unstaged = info?.unstaged ?? 0
        setStore({
          status: "ready",
          branch,
          staged: info?.staged ?? 0,
          unstaged,
          hasRemote: info?.hasRemote ?? false,
          githubAvailable: info?.github.available ?? false,
          githubAuthenticated: info?.github.authenticated ?? false,
          files: list.length,
          added: list.reduce((sum, item) => sum + (item?.added ?? 0), 0),
          removed: list.reduce((sum, item) => sum + (item?.removed ?? 0), 0),
          includeUnstaged: unstaged > 0,
          message: branch,
        })
      })
      .catch((value: unknown) => {
        setStore({ status: "error", error: err(value) })
      })
  })

  const summary = createMemo(() => {
    if (store.includeUnstaged) {
      return language.t("commit.dialog.summary.all", {
        staged: String(store.staged),
        unstaged: String(store.unstaged),
      })
    }

    return language.t("commit.dialog.summary.staged", {
      staged: String(store.staged),
    })
  })

  const ready = createMemo(() => store.staged + (store.includeUnstaged ? store.unstaged : 0) > 0)

  const options = createMemo(() => {
    const pushDisabled = !store.branch || !store.hasRemote
    const prDisabled = !store.branch || !store.hasRemote || !store.githubAvailable || !store.githubAuthenticated
    return [
      {
        id: "commit" as const,
        label: language.t("commit.dialog.action.commit"),
        disabled: false,
      },
      {
        id: "push" as const,
        label: language.t("commit.dialog.action.push"),
        disabled: pushDisabled,
      },
      {
        id: "pr" as const,
        label: language.t("commit.dialog.action.pr"),
        disabled: prDisabled,
      },
    ]
  })

  const hint = createMemo(() => {
    if (store.action === "push" && !store.hasRemote) return language.t("commit.dialog.hint.remote")
    if (store.action !== "pr") return undefined
    if (!store.hasRemote) return language.t("commit.dialog.hint.remote")
    if (!store.githubAvailable) return language.t("commit.dialog.hint.github")
    if (!store.githubAuthenticated) return language.t("commit.dialog.hint.auth")
  })

  const submit = async () => {
    if (!store.message.trim() || store.submitting) return
    setStore("submitting", true)
    setStore("error", undefined)

    try {
      const result = await sdk.client.vcs.commit({
        directory: sdk.directory,
        vcsCommitInput: {
          message: store.message.trim(),
          includeUnstaged: store.includeUnstaged,
          action: store.action,
        },
      })
      const next = await sdk.client.vcs.get({ directory: sdk.directory })
      if (next.data) sync.set("vcs", next.data)

      showToast({
        variant: "success",
        icon: "circle-check",
        title:
          store.action === "commit"
            ? language.t("commit.dialog.toast.commit")
            : store.action === "push"
              ? language.t("commit.dialog.toast.push")
              : language.t("commit.dialog.toast.pr"),
        description: result.data?.url,
      })
      dialog.close()
    } catch (value: unknown) {
      setStore("error", err(value))
    } finally {
      setStore("submitting", false)
    }
  }

  return (
    <Dialog title={language.t("commit.dialog.title")}>
      <div class="flex flex-col gap-4 px-5 pb-5">
        <Show when={store.status === "loading"}>
          <div class="flex items-center gap-2 text-12-regular text-text-weak">
            <Spinner class="size-3 text-icon-weak" />
            <span>{language.t("commit.dialog.loading")}</span>
          </div>
        </Show>

        <Show when={store.status !== "loading"}>
          <>
            <div class="flex items-center justify-between gap-3">
              <span class="text-12-medium text-text-weak">{language.t("commit.dialog.branch")}</span>
              <div class="flex items-center gap-2 min-w-0">
                <Icon name="branch" size="small" class="text-icon-weak shrink-0" />
                <span class="text-14-medium text-text-strong truncate">
                  {store.branch || language.t("commit.dialog.branchUnknown")}
                </span>
              </div>
            </div>

            <div class="flex items-center justify-between gap-3">
              <span class="text-12-medium text-text-weak">{language.t("commit.dialog.changes")}</span>
              <div class="flex items-center gap-2 text-14-medium text-text-strong">
                <span>{language.t("commit.dialog.files", { count: String(store.files) })}</span>
                <span class="text-text-success">+{store.added}</span>
                <span class="text-text-danger">-{store.removed}</span>
              </div>
            </div>

            <Switch
              checked={store.includeUnstaged}
              disabled={store.unstaged === 0}
              onChange={(value) => setStore("includeUnstaged", value)}
            >
              {language.t("commit.dialog.includeUnstaged")}
            </Switch>

            <p class="text-12-regular text-text-weak">{summary()}</p>

            <div class="flex flex-col gap-1.5">
              <label class="text-12-medium text-text-strong">{language.t("commit.dialog.message")}</label>
              <TextField
                value={store.message}
                onInput={(e) => setStore("message", e.currentTarget.value)}
                placeholder={language.t("commit.dialog.placeholder")}
                autofocus
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key !== "Enter" || e.shiftKey) return
                  e.preventDefault()
                  submit()
                }}
              />
            </div>

            <div class="flex flex-col gap-2">
              <span class="text-12-medium text-text-strong">{language.t("commit.dialog.next")}</span>
              <div class="overflow-hidden rounded-md border border-border-weak-base bg-surface-panel">
                <For each={options()}>
                  {(item) => (
                    <button
                      type="button"
                      class="flex w-full items-center justify-between gap-3 border-0 border-b border-border-weak-base bg-transparent px-3 py-3 text-left last:border-b-0 disabled:cursor-not-allowed disabled:text-text-weaker"
                      classList={{
                        "bg-surface-raised-base": store.action === item.id,
                      }}
                      disabled={item.disabled}
                      onClick={() => setStore("action", item.id)}
                    >
                      <span class="text-14-medium">{item.label}</span>
                      <Show when={store.action === item.id}>
                        <Icon name="check-small" size="small" class="text-icon-strong shrink-0" />
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </div>

            <Show when={hint()}>
              <p class="text-12-regular text-text-weak">{hint()}</p>
            </Show>

            <Show when={store.error}>
              <div class="flex items-start gap-2 rounded-md border border-border-critical-base bg-surface-critical-weak px-3 py-2.5">
                <Icon name="circle-x" size="small" class="text-icon-critical-base shrink-0 mt-px" />
                <span class="flex-1 text-13-regular text-text-danger whitespace-pre-wrap break-words">
                  {store.error}
                </span>
              </div>
            </Show>

            <div class="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => dialog.close()}>
                {language.t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={submit}
                disabled={store.status !== "ready" || !ready() || !store.message.trim() || store.submitting}
              >
                {store.submitting ? language.t("commit.dialog.submitting") : language.t("commit.dialog.continue")}
              </Button>
            </div>
          </>
        </Show>
      </div>
    </Dialog>
  )
}

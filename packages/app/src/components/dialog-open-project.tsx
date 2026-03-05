import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Progress } from "@opencode-ai/ui/progress"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { createStore } from "solid-js/store"
import { createEffect, onMount, Show } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import {
  parseProjectInput,
  projectOpenError,
  resolveCloneRepositoryUrl,
  suggestCloneTargetPath,
} from "./dialog-open-project.helpers"

type Mode = "git" | "path"

export function DialogOpenProject(props: {
  onSelect: (directory: string) => void
  mode?: Mode
  lockMode?: boolean
  title?: string
}) {
  const dialog = useDialog()
  const platform = usePlatform()
  const language = useLanguage()
  const sdk = useGlobalSDK()
  const title = () => props.title ?? language.t("command.project.open")

  const [store, setStore] = createStore({
    mode: (props.mode ?? "git") as Mode,
    value: "",
    target: "",
    targetRoot: "",
    targetManual: false,
    busy: false,
    error: "",
  })

  onMount(() => {
    if (!platform.getDefaultCloneDirectory) return
    void platform.getDefaultCloneDirectory().then((root) => {
      if (!root) return
      setStore("targetRoot", root)
    })
  })

  createEffect(() => {
    if (store.mode !== "git") return
    if (store.targetManual) return
    const root = parseProjectInput(store.targetRoot)
    if (!root) return
    setStore("target", suggestCloneTargetPath(store.value, root))
  })

  async function browse() {
    if (!platform.openDirectoryPickerDialog) return
    const result = await platform.openDirectoryPickerDialog({
      title: title(),
      multiple: false,
    })

    if (Array.isArray(result)) {
      if (!result[0]) return
      setStore("value", result[0])
      setStore("error", "")
      return
    }

    if (!result) return
    setStore("value", result)
    setStore("error", "")
  }

  async function browseTarget() {
    if (!platform.openDirectoryPickerDialog) return
    const result = await platform.openDirectoryPickerDialog({
      title: title(),
      multiple: false,
    })

    if (Array.isArray(result)) {
      if (!result[0]) return
      setStore("target", result[0])
      setStore("targetManual", true)
      return
    }

    if (!result) return
    setStore("target", result)
    setStore("targetManual", true)
  }

  async function openPath(input: string) {
    if (!input) throw new Error(language.t("dialog.project.open.error.pathRequired"))
    const directory = platform.normalizeProjectPath ? await platform.normalizeProjectPath(input) : input

    await sdk.client.file.list({ directory, path: "" })
    props.onSelect(directory)
  }

  async function clone(input: string) {
    const url = resolveCloneRepositoryUrl(input)
    if (!url) {
      throw new Error(language.t("dialog.project.open.error.gitInvalid"))
    }
    if (!platform.cloneGitRepository) throw new Error(language.t("common.requestFailed"))

    const target = parseProjectInput(store.target)
    const directory = await platform.cloneGitRepository(
      url,
      target ? (platform.normalizeProjectPath ? await platform.normalizeProjectPath(target) : target) : undefined,
    )

    await sdk.client.file.list({ directory, path: "" })
    props.onSelect(directory)
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault()
    if (store.busy) return

    setStore("busy", true)
    setStore("error", "")

    await Promise.resolve()
      .then(async () => {
        const value = parseProjectInput(store.value)
        if (store.mode === "git") {
          await clone(value)
          dialog.close()
          return
        }

        await openPath(value)
        dialog.close()
      })
      .catch((error) => {
        setStore("error", projectOpenError(error))
      })
      .finally(() => {
        setStore("busy", false)
      })
  }

  return (
    <Dialog title={title()} class="w-full max-w-[480px] mx-auto" fit transition>
      <form onSubmit={submit} class="flex flex-col gap-5 p-6 pt-0">
        <Show when={props.lockMode && store.mode === "git"}>
          <div class="flex flex-col gap-2">
            <div class="text-14-medium text-text-strong">
              {language.t("dialog.project.open.git.label")}
              <span class="text-text-muted"> ({language.t("dialog.project.open.git.helper")})</span>
            </div>
            <TextField
              autofocus
              type="text"
              value={store.value}
              label=""
              placeholder={language.t("dialog.project.open.git.placeholder")}
              onChange={(value: string) => {
                setStore("value", value)
                if (!store.error) return
                setStore("error", "")
              }}
            />
          </div>

          <div class="flex flex-col gap-2 -mt-1 rounded-md border border-border-base bg-surface-raised-base px-3 py-2.5">
            <div class="text-14-medium text-text-strong">Local Path</div>
            <div class="flex items-center gap-2">
              <input
                type="text"
                class="flex-1 h-9 rounded-md border border-border-base bg-surface-base px-3 text-14-regular text-text-strong"
                value={store.target}
                placeholder={store.targetRoot || "~/Documents/code"}
                onInput={(event) => {
                  setStore("target", event.currentTarget.value)
                  setStore("targetManual", true)
                }}
              />
              <Button type="button" variant="secondary" size="large" class="min-w-24" onClick={browseTarget}>
                Choose...
              </Button>
            </div>
            <div class="text-12-regular text-text-weak">{language.t("dialog.project.open.path.hint")}</div>
          </div>
        </Show>

        <Show when={!props.lockMode}>
          <div class="flex rounded-lg p-1 bg-surface-raised-base border border-border-base gap-1">
            <Button
              type="button"
              size="small"
              class="flex-1"
              variant={store.mode === "git" ? "primary" : "ghost"}
              onClick={() => {
                setStore("mode", "git")
                setStore("error", "")
              }}
            >
              {language.t("dialog.project.open.mode.git")}
            </Button>
            <Button
              type="button"
              size="small"
              class="flex-1"
              variant={store.mode === "path" ? "primary" : "ghost"}
              onClick={() => {
                setStore("mode", "path")
                setStore("error", "")
              }}
            >
              {language.t("dialog.project.open.mode.path")}
            </Button>
          </div>
        </Show>

        <Show when={!props.lockMode}>
          <TextField
            autofocus
            type="text"
            value={store.value}
            label={
              store.mode === "git"
                ? language.t("dialog.project.open.git.label")
                : language.t("dialog.project.open.path.label")
            }
            placeholder={
              store.mode === "git"
                ? language.t("dialog.project.open.git.placeholder")
                : language.t("dialog.project.open.path.placeholder")
            }
            onChange={(value: string) => {
              setStore("value", value)
              if (!store.error) return
              setStore("error", "")
            }}
          />
        </Show>

        <Show when={store.mode === "path" && !!platform.openDirectoryPickerDialog}>
          <div class="-mt-2">
            <Button type="button" variant="ghost" size="small" onClick={browse}>
              {language.t("dialog.project.open.path.browse")}
            </Button>
          </div>
        </Show>

        <Show when={!!store.error}>
          <div class="text-12-regular text-text-danger-base">{store.error}</div>
        </Show>

        <Show when={store.busy && store.mode === "git"}>
          <Progress
            indeterminate
            aria-label={language.t("dialog.project.open.submit.cloning")}
            class={
              props.lockMode
                ? "-mt-2 gap-1 [&_[data-slot='progress-label']]:text-12-regular [&_[data-slot='progress-track']]:h-1"
                : "-mt-1 [&_[data-slot='progress-track']]:h-1"
            }
          >
            {language.t("dialog.project.open.submit.cloning")}
          </Progress>
        </Show>

        <div class="-mx-6 -mb-6 mt-1 flex justify-end gap-2 border-t border-border-base bg-surface-raised-base px-6 py-4">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="large"
            disabled={store.busy}
            class="min-w-24 justify-center gap-2"
          >
            <Show when={store.busy}>
              <Spinner class="size-3" />
            </Show>
            {store.busy
              ? store.mode === "git"
                ? language.t("dialog.project.open.submit.cloning")
                : language.t("dialog.project.open.submit.opening")
              : store.mode === "git"
                ? props.lockMode
                  ? "Clone"
                  : language.t("dialog.project.open.submit.git")
                : language.t("dialog.project.open.submit.path")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

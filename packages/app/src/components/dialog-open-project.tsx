import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { createStore } from "solid-js/store"
import { Show } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { parseProjectInput, projectOpenError } from "./dialog-open-project.helpers"
import { cloneProject, DialogOpenProjectGit } from "./dialog-open-project-git"

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

  async function openPath(input: string) {
    if (!input) throw new Error(language.t("dialog.project.open.error.pathRequired"))
    const directory = platform.normalizeProjectPath ? await platform.normalizeProjectPath(input) : input

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
          await cloneProject({
            input: value,
            target: store.target,
            platform,
            sdk,
            language,
            onSelect: props.onSelect,
          })
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
          <DialogOpenProjectGit
            title={title()}
            lockMode={props.lockMode}
            value={store.value}
            target={store.target}
            targetRoot={store.targetRoot}
            targetManual={store.targetManual}
            busy={store.busy}
            setValue={(value) => setStore("value", value)}
            setTarget={(value, manual) => {
              setStore("target", value)
              if (manual !== undefined) setStore("targetManual", manual)
            }}
            setTargetRoot={(value) => setStore("targetRoot", value)}
            clearError={() => {
              if (!store.error) return
              setStore("error", "")
            }}
          />
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
          <Show
            when={store.mode === "git"}
            fallback={
              <TextField
                autofocus
                type="text"
                value={store.value}
                label={language.t("dialog.project.open.path.label")}
                placeholder={language.t("dialog.project.open.path.placeholder")}
                onChange={(value: string) => {
                  setStore("value", value)
                  if (!store.error) return
                  setStore("error", "")
                }}
              />
            }
          >
            <DialogOpenProjectGit
              title={title()}
              value={store.value}
              target={store.target}
              targetRoot={store.targetRoot}
              targetManual={store.targetManual}
              busy={store.busy}
              setValue={(value) => setStore("value", value)}
              setTarget={(value, manual) => {
                setStore("target", value)
                if (manual !== undefined) setStore("targetManual", manual)
              }}
              setTargetRoot={(value) => setStore("targetRoot", value)}
              clearError={() => {
                if (!store.error) return
                setStore("error", "")
              }}
            />
          </Show>
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

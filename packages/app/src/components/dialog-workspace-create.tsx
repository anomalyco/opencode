import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"
import { For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { DialogSelectDirectory } from "./dialog-select-directory"

interface DialogWorkspaceCreateProps {
  onCreate?: (name: string, folders: string[]) => Promise<void> | void
  initialName?: string
  initialFolders?: string[]
}

function once<T extends (...args: any[]) => void>(fn: T): T {
  let called = false
  return ((...args: any[]) => {
    if (called) return
    called = true
    return fn(...args)
  }) as T
}

export function DialogWorkspaceCreate(props: DialogWorkspaceCreateProps) {
  const dialog = useDialog()
  const language = useLanguage()

  const [store, setStore] = createStore({
    name: props.initialName ?? "",
    folders: props.initialFolders ?? [],
    error: "",
    creating: false,
  })

  function addFolder() {
    const currentName = store.name
    const currentFolders = store.folders

    const reopen = (folders: string[]) => {
      queueMicrotask(() => {
        dialog.show(() => (
          <DialogWorkspaceCreate {...props} initialName={currentName} initialFolders={folders} />
        ))
      })
    }

    dialog.show(
      () => (
        <DialogSelectDirectory
          title={language.t("dialog.workspace.create.addFolder")}
          onSelect={once((result) => {
            const nextFolders =
              result && typeof result === "string"
                ? (() => {
                    const normalized = result.trim()
                    if (normalized && !currentFolders.includes(normalized)) {
                      return [...currentFolders, normalized]
                    }
                    return currentFolders
                  })()
                : currentFolders
            reopen(nextFolders)
          })}
        />
      ),
      once(() => reopen(currentFolders)),
    )
  }

  function removeFolder(index: number) {
    setStore("folders", (prev) => prev.filter((_, i) => i !== index))
  }

  async function handleCreate() {
    const name = store.name.trim()
    if (!name || store.folders.length === 0) return
    if (store.creating) return

    setStore("creating", true)
    try {
      await props.onCreate?.(name, store.folders)
      dialog.close()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStore("error", message)
    } finally {
      setStore("creating", false)
    }
  }

  const canCreate = () => store.name.trim().length > 0 && store.folders.length > 0 && !store.creating

  return (
    <Dialog title={language.t("dialog.workspace.create.title")} class="w-full max-w-[480px] mx-auto">
      <form
        class="flex flex-col gap-6 p-6 pt-0"
        onSubmit={(e) => {
          e.preventDefault()
          handleCreate()
        }}
      >
        <div class="flex flex-col gap-4">
          <TextField
            autofocus
            type="text"
            label={language.t("dialog.workspace.create.name")}
            placeholder={language.t("dialog.workspace.create.name.placeholder")}
            value={store.name}
            onChange={(v) => {
              setStore("name", v)
              setStore("error", "")
            }}
          />

          <div class="flex flex-col gap-2">
            <label class="text-12-medium text-text-weak">{language.t("dialog.workspace.create.folders")}</label>
            <Show
              when={store.folders.length > 0}
              fallback={
                <div class="text-14-regular text-text-weak py-2">
                  {language.t("dialog.workspace.create.folders.empty")}
                </div>
              }
            >
              <div class="flex flex-col gap-1.5">
                <For each={store.folders}>
                  {(folder, index) => (
                    <div class="flex items-center gap-2 rounded-md border border-border-base px-3 py-2 bg-surface-base">
                      <span class="text-14-regular text-text-strong flex-1 min-w-0 truncate">{folder}</span>
                      <IconButton
                        size="normal"
                        variant="ghost"
                        icon="trash"
                        onClick={() => removeFolder(index())}
                        aria-label={language.t("dialog.workspace.create.removeFolder")}
                      />
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Button type="button" variant="secondary" size="normal" icon="plus" onClick={addFolder}>
              {language.t("dialog.workspace.create.addFolder")}
            </Button>
          </div>

          <Show when={store.error}>
            <div class="text-14-regular text-text-error">{store.error}</div>
          </Show>
        </div>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="large"
            disabled={!canCreate()}
          >
            {store.creating
              ? language.t("common.saving")
              : language.t("dialog.workspace.create.button")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { createMemo, createSignal, Show } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"

interface DialogCreateFolderProps {
  /** Called with the absolute path of the successfully created folder. */
  onCreated: (path: string) => void
}

function joinPath(base: string, name: string) {
  return base.replace(/\/+$/, "") + "/" + name
}

// Characters disallowed in directory names across major platforms.
const INVALID_CHARS = /[<>:"|?*\x00-\x1F]/

export function DialogCreateFolder(props: DialogCreateFolderProps) {
  const sdk = useGlobalSDK()
  const sync = useGlobalSync()
  const dialog = useDialog()
  const language = useLanguage()

  const home = createMemo(() => sync.data.path.home || "~")

  const [folderName, setFolderName] = createSignal("")
  const [parentDir, setParentDir] = createSignal(home())
  const [error, setError] = createSignal("")
  const [creating, setCreating] = createSignal(false)

  async function handleCreate() {
    const name = folderName().trim()
    if (!name) {
      setError(language.t("dialog.createFolder.error.empty"))
      return
    }
    if (INVALID_CHARS.test(name)) {
      setError(language.t("dialog.createFolder.error.invalid"))
      return
    }

    const parent = parentDir().trim() || home()
    const fullPath = joinPath(parent, name)

    setError("")
    setCreating(true)
    try {
      // Pass the parent as `directory` so InstanceMiddleware resolves an
      // instance context (the same way DialogSelectDirectory uses file.list).
      const res = await sdk.client.file.mkdir({ directory: parent, path: fullPath })
      const created = res.data?.path
      if (!created) {
        setError(language.t("dialog.createFolder.error.failed"))
        return
      }
      props.onCreated(created)
      dialog.close()
    } catch (err: any) {
      setError(err?.message ?? language.t("dialog.createFolder.error.failed"))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog title={language.t("dialog.createFolder.title")}>
      <div class="flex flex-col gap-4 p-4">
        {/* Parent directory */}
        <div class="flex flex-col gap-1">
          <label class="text-12-regular text-text-weak">{language.t("dialog.createFolder.parentLabel")}</label>
          <input
            type="text"
            class="w-full rounded-md border border-border-base-base bg-bg-base-base px-3 py-2 text-14-regular text-text-strong placeholder:text-text-weak focus:outline-none focus:ring-1 focus:ring-border-focus-base"
            value={parentDir()}
            onInput={(e) => setParentDir(e.currentTarget.value)}
          />
        </div>

        {/* Folder name */}
        <div class="flex flex-col gap-1">
          <label class="text-12-regular text-text-weak">{language.t("dialog.createFolder.label")}</label>
          <input
            type="text"
            class="w-full rounded-md border border-border-base-base bg-bg-base-base px-3 py-2 text-14-regular text-text-strong placeholder:text-text-weak focus:outline-none focus:ring-1 focus:ring-border-focus-base"
            placeholder={language.t("dialog.createFolder.placeholder")}
            value={folderName()}
            onInput={(e) => {
              setFolderName(e.currentTarget.value)
              setError("")
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate()
            }}
            autofocus
          />
        </div>

        {/* Inline error */}
        <Show when={error()}>
          <p class="text-12-regular text-text-critical">{error()}</p>
        </Show>

        {/* Submit */}
        <Button class="w-full justify-center" onClick={() => void handleCreate()} disabled={creating()}>
          {creating() ? language.t("common.loading") : language.t("dialog.createFolder.create")}
        </Button>
      </div>
    </Dialog>
  )
}

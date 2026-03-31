import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { createMemo, createResource, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useServer } from "@/context/server"
import { useLanguage } from "@/context/language"
import { DialogClientConfig } from "./dialog-client-config"

export function DialogCreateProject(props: { onSelect: (path: string) => void }) {
  const dialog = useDialog()
  const sdk = useGlobalSDK()
  const sync = useGlobalSync()
  const server = useServer()
  const language = useLanguage()

  const missingBase = createMemo(() => !(sync.data.path.home || sync.data.path.directory))

  const [fallbackPath] = createResource(
    () => (missingBase() ? true : undefined),
    async () =>
      sdk.client.path
        .get()
        .then((x) => x.data)
        .catch(() => undefined),
    { initialValue: undefined },
  )

  const home = createMemo(() => sync.data.path.home || fallbackPath()?.home || "~")

  const [store, setStore] = createStore({
    name: "",
    creating: false,
    error: "",
  })

  const fullPath = createMemo(() => {
    const name = store.name.trim()
    if (!name) return ""
    return `${home().replace(/\/+$/, "")}/${name}`
  })

  async function handleCreate(e: SubmitEvent) {
    e.preventDefault()
    const path = fullPath()
    if (!path) return

    setStore({ creating: true, error: "" })
    const ok = await sdk.client.file
      .mkdir({ path })
      .then(() => true)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : language.t("common.requestFailed")
        setStore("error", msg)
        return false
      })

    setStore("creating", false)
    if (!ok) return

    props.onSelect(path)
    dialog.show(() => <DialogClientConfig directory={path} />)
  }

  return (
    <Dialog title={language.t("dialog.project.create.title")} class="w-full max-w-[480px] mx-auto">
      <form onSubmit={handleCreate} class="flex flex-col gap-4 p-6 pt-0">
        <TextField
          autofocus
          type="text"
          label={language.t("dialog.project.create.name")}
          placeholder={language.t("dialog.project.create.name.placeholder")}
          value={store.name}
          onChange={(v: string) => setStore("name", v)}
        />

        <Show when={store.error}>
          <p class="text-12-regular text-text-danger">{store.error}</p>
        </Show>

        <div class="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={!fullPath() || store.creating}>
            {store.creating ? language.t("common.loading") : language.t("dialog.project.create.submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

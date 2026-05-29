import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { ButtonV2 } from "@opencode-ai/ui/v2/components/button-v2.jsx"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/components/icon.jsx"
import { createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"

type Tab = "github" | "folder"

export function DialogNewProject(props: {
  onOpenSession: (directory: string) => void
  onSelectDirectory: () => void
}) {
  const dialog = useDialog()
  const platform = usePlatform()
  const language = useLanguage()
  const server = useServer()
  const [tab, setTab] = createSignal<Tab>("github")
  const [store, setStore] = createStore({
    url: "",
    destination: "",
    cloning: false,
    error: "" as string | undefined,
  })

  async function pickDestination() {
    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog({
        title: language.t("dialog.newProject.destination.pick"),
        multiple: false,
      })
      const dir = Array.isArray(result) ? result[0] : result
      if (dir) setStore("destination", dir)
    }
  }

  async function handleClone(e: SubmitEvent) {
    e.preventDefault()
    const url = store.url.trim()
    const destination = store.destination.trim()
    if (!url) return
    if (!destination) return

    setStore("cloning", true)
    setStore("error", undefined)

    try {
      const conn = server.current
      if (!conn) {
        setStore("error", language.t("dialog.newProject.error.cloneFailed"))
        return
      }
      const baseUrl = conn.http.url.replace(/\/+$/, "")
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }
      if (conn.http.password) {
        headers.Authorization = `Basic ${authTokenFromCredentials({
          username: conn.http.username,
          password: conn.http.password,
        })}`
      }
      const response = await (platform.fetch ?? globalThis.fetch)(`${baseUrl}/project/clone`, {
        method: "POST",
        headers,
        body: JSON.stringify({ url, destination }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        const message =
          (body as { data?: { message?: string } }).data?.message ??
          (body as { message?: string }).message ??
          response.statusText
        setStore("error", message)
        return
      }
      const raw = (await response.json()) as { directory?: string }
      if (raw.directory) {
        dialog.close()
        props.onOpenSession(raw.directory)
      } else {
        setStore("error", language.t("dialog.newProject.error.cloneFailed"))
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setStore("error", message)
    } finally {
      setStore("cloning", false)
    }
  }

  function handleFolderImport() {
    dialog.close()
    props.onSelectDirectory()
  }

  return (
    <Dialog title={language.t("dialog.newProject.title")} class="w-full max-w-[520px] mx-auto">
      <div class="flex flex-col gap-4 p-6 pt-0">
        <div class="flex gap-1 rounded-lg bg-v2-background-bg-deep p-1">
          <button
            type="button"
            class="flex-1 rounded-md px-3 py-1.5 text-sm [font-weight:440] transition-colors"
            classList={{
              "bg-v2-background-bg-base text-v2-text-text-base shadow-[var(--v2-elevation-raised)]": tab() === "github",
              "text-v2-text-text-muted hover:text-v2-text-text-base": tab() !== "github",
            }}
            onClick={() => setTab("github")}
          >
            <IconV2 name="git-branch" size="small" class="mr-1.5 inline-block align-text-bottom" />
            {language.t("dialog.newProject.tab.github")}
          </button>
          <button
            type="button"
            class="flex-1 rounded-md px-3 py-1.5 text-sm [font-weight:440] transition-colors"
            classList={{
              "bg-v2-background-bg-base text-v2-text-text-base shadow-[var(--v2-elevation-raised)]": tab() === "folder",
              "text-v2-text-text-muted hover:text-v2-text-text-base": tab() !== "folder",
            }}
            onClick={() => setTab("folder")}
          >
            <IconV2 name="folder" size="small" class="mr-1.5 inline-block align-text-bottom" />
            {language.t("dialog.newProject.tab.folder")}
          </button>
        </div>

        <Show when={tab() === "github"}>
          <form onSubmit={handleClone} class="flex flex-col gap-4">
            <TextField
              autofocus
              type="text"
              label={language.t("dialog.newProject.url.label")}
              placeholder="https://github.com/owner/repo"
              value={store.url}
              onChange={(v) => setStore("url", v)}
              spellcheck={false}
            />

            <div class="flex flex-col gap-1.5">
              <label class="text-12-medium text-text-weak">{language.t("dialog.newProject.destination.label")}</label>
              <div class="flex gap-2">
                <TextField
                  type="text"
                  class="flex-1"
                  placeholder={language.t("dialog.newProject.destination.placeholder")}
                  value={store.destination}
                  onChange={(v) => setStore("destination", v)}
                  spellcheck={false}
                />
                <Show when={platform.openDirectoryPickerDialog && server.isLocal()}>
                  <ButtonV2 variant="neutral" size="normal" onClick={pickDestination} type="button">
                    {language.t("dialog.newProject.destination.browse")}
                  </ButtonV2>
                </Show>
              </div>
            </div>

            <Show when={store.error}>
              {(error) => (
                <div class="rounded-md bg-surface-critical-base/10 px-3 py-2 text-12-regular text-text-critical-base">
                  {error()}
                </div>
              )}
            </Show>

            <div class="flex justify-end gap-2 pt-2">
              <ButtonV2 variant="ghost" size="normal" onClick={() => dialog.close()} type="button">
                {language.t("common.cancel")}
              </ButtonV2>
              <ButtonV2
                variant="contrast"
                size="normal"
                type="submit"
                disabled={store.cloning || !store.url.trim() || !store.destination.trim()}
              >
                {store.cloning ? language.t("dialog.newProject.cloning") : language.t("dialog.newProject.clone")}
              </ButtonV2>
            </div>
          </form>
        </Show>

        <Show when={tab() === "folder"}>
          <div class="flex flex-col items-center gap-4 py-8 text-center">
            <div class="flex size-10 items-center justify-center rounded-[10px] bg-v2-background-bg-deep text-v2-icon-icon-muted shadow-[var(--v2-elevation-raised)]">
              <IconV2 name="folder" />
            </div>
            <div class="flex max-w-[320px] flex-col gap-1">
              <div class="text-v2-text-text-base [font-weight:530]">
                {language.t("dialog.newProject.folder.title")}
              </div>
              <div class="text-v2-text-text-muted [font-weight:440]">
                {language.t("dialog.newProject.folder.description")}
              </div>
            </div>
            <ButtonV2 variant="neutral" size="normal" icon="folder-add-left" onClick={handleFolderImport}>
              {language.t("dialog.newProject.folder.action")}
            </ButtonV2>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}

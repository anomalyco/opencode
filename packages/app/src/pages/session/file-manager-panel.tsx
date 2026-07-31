import { Show, createEffect, createMemo, createSignal, For } from "solid-js"
import { createStore } from "solid-js/store"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { useSDK } from "@/context/sdk"
import { useSessionLayout } from "@/pages/session/session-layout"
import { useServer } from "@/context/server"
import { useLanguage } from "@/context/language"
import { useConfirm } from "@/components/confirm-dialog"
import { deleteFile, downloadFile, fsAuthHeaders, uploadFile } from "@/utils/file-transfer"

type FileEntry = { path: string; type: "file" | "directory" }

export function FileManagerPanel() {
  const sdk = useSDK()
  const server = useServer()
  const language = useLanguage()
  const confirm = useConfirm()
  const { view } = useSessionLayout()

  const [entries, setEntries] = createStore<FileEntry[]>([])
  const [loading, setLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)
  const [uploading, setUploading] = createSignal(false)
  const [dragOver, setDragOver] = createSignal(false)

  const opened = createMemo(() => view().fileManager.opened())

  const directory = createMemo(() => sdk().directory)

  createEffect(() => {
    if (!opened()) return
    loadFiles()
  })

  async function loadFiles() {
    setLoading(true)
    setError(null)
    try {
      const result = await sdk().api.file.list()
      const data = result.data ?? []
      setEntries(data as FileEntry[])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload(file: File) {
    setUploading(true)
    setError(null)
    try {
      await uploadFile({
        url: sdk().url,
        directory: directory(),
        headers: fsAuthHeaders(server.current),
        path: file.name,
        file,
      })
      await loadFiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }

  async function handleDownload(path: string) {
    try {
      await downloadFile({
        url: sdk().url,
        directory: directory(),
        headers: fsAuthHeaders(server.current),
        path,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleDelete(path: string) {
    const ok = await confirm({ title: language.t("common.delete"), message: language.t("session.files.deleteConfirm", { path }) })
    if (!ok) return
    try {
      await deleteFile({
        url: sdk().url,
        directory: directory(),
        headers: fsAuthHeaders(server.current),
        path,
      })
      await loadFiles()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function onFilePick(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    void handleUpload(file)
    input.value = ""
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    setDragOver(false)
    const file = event.dataTransfer?.files?.[0]
    if (!file) return
    void handleUpload(file)
  }

  function onDragOver(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    setDragOver(true)
  }

  function onDragLeave(event: DragEvent) {
    event.stopPropagation()
    setDragOver(false)
  }

  return (
    <div
      id="file-manager-panel"
      role="region"
      aria-label={language.t("session.header.open.fileManager")}
      aria-hidden={!opened()}
      inert={!opened()}
      class="relative w-full shrink-0 bg-background-stronger overflow-hidden"
      classList={{
        "transition-[height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[height] motion-reduce:transition-none": true,
        "drop-target": dragOver(),
      }}
      style={{ height: opened() ? "200px" : "0px" }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div class="absolute inset-x-0 top-0 flex flex-col overflow-hidden border-t border-border-weak-base"
        classList={{ "pointer-events-none": !opened() }}
        style={{ height: "200px" }}
      >
        <div class="h-9 flex items-center gap-2 px-2 border-b border-border-weaker-base bg-background-stronger shrink-0">
          <Icon name="cloud-upload" size="small" class="text-icon-weak" />
          <span class="text-13-medium text-text-strong">{language.t("session.header.open.fileManager")}</span>
          <div class="flex-1" />
          <IconButton
            icon="plus-small"
            variant="ghost"
            iconSize="large"
            aria-label={language.t("session.files.uploadFile")}
            onClick={() => document.getElementById("file-manager-upload-input")?.click()}
          />
          <input id="file-manager-upload-input" type="file" class="hidden" onChange={onFilePick} disabled={uploading()} />
          <IconButton icon="reset" variant="ghost" iconSize="large" onClick={loadFiles} aria-label={language.t("session.files.refresh")} />
        </div>

        <div
          class="flex-1 min-h-0 overflow-y-auto p-2"
          onDrop={onDrop}
          onDragOver={onDragOver}
        >
          <Show when={loading()}>
            <div class="flex items-center justify-center h-full text-13-regular text-text-weak">
              {language.t("common.loading")}
            </div>
          </Show>
          <Show when={error()}>
            <div class="flex items-center gap-2 px-2 py-1 text-13-regular text-text-danger">
              <Icon name="warning" size="small" />
              <span>{error()}</span>
            </div>
          </Show>
          <Show when={!loading() && !error() && entries.length === 0}>
            <div class="flex flex-col items-center justify-center h-full text-13-regular text-text-weak gap-2">
              <Icon name="cloud-upload" size="medium" />
              <span>{language.t("session.files.dropFiles")}</span>
            </div>
          </Show>
          <Show when={!loading() && entries.length > 0}>
            <For each={entries}>
              {(entry) => (
                <div class="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-base group">
                  <Icon name={entry.type === "directory" ? "folder" : "code"} size="small" class="text-icon-weak shrink-0" />
                  <span class="flex-1 min-w-0 truncate text-13-regular text-text-strong">{entry.path}</span>
                  <Show when={entry.type === "file"}>
                    <button
                      onClick={() => void handleDownload(entry.path)}
                      class="opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={language.t("session.files.downloadFile")}
                    >
                      <Icon name="download" size="small" class="text-icon-weak" />
                    </button>
                    <button
                      onClick={() => void handleDelete(entry.path)}
                      class="opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={language.t("common.delete")}
                    >
                      <Icon name="trash" size="small" class="text-icon-weak" />
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </Show>
        </div>

        <Show when={uploading()}>
          <div class="h-1 bg-accent-base animate-pulse" />
        </Show>
      </div>
    </div>
  )
}

import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Icon } from "@opencode-ai/ui/icon"
import { createMemo, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { type LocalProject, getAvatarColors } from "@/context/layout"
import { getFilename } from "@opencode-ai/util/path"
import { Avatar } from "@opencode-ai/ui/avatar"

const AVATAR_COLOR_KEYS = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const

export function DialogEditProject(props: { project: LocalProject }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()

  const folderName = createMemo(() => getFilename(props.project.worktree))
  const defaultName = createMemo(() => props.project.name || folderName())

  const [store, setStore] = createStore({
    name: defaultName(),
    color: props.project.icon?.color || "pink",
    iconUrl: props.project.icon?.url || "",
    saving: false,
  })

  const [dragOver, setDragOver] = createSignal(false)

  function handleFileSelect(file: File) {
    if (!file.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = (e) => setStore("iconUrl", e.target?.result as string)
    reader.readAsDataURL(file)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer?.files[0]
    if (file) handleFileSelect(file)
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    setDragOver(true)
  }

  function handleDragLeave() {
    setDragOver(false)
  }

  function handleInputChange(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (file) handleFileSelect(file)
  }

  function clearIcon() {
    setStore("iconUrl", "")
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (!props.project.id) return

    setStore("saving", true)
    const name = store.name.trim() === folderName() ? "" : store.name.trim()
    await globalSDK.client.project.update({
      projectID: props.project.id,
      name,
      icon: { color: store.color, url: store.iconUrl },
    })
    setStore("saving", false)
    dialog.close()
  }

  return (
    <Dialog title="Edit project">
      <form onSubmit={handleSubmit} class="flex flex-col gap-6 px-2.5 pb-3">
        <div class="flex flex-col gap-4">
          <TextField
            autofocus
            type="text"
            label="Name"
            placeholder={folderName()}
            value={store.name}
            onChange={(v) => setStore("name", v)}
          />

          <div class="flex flex-col gap-2">
            <label class="text-12-medium text-text-weak">Icon</label>
            <div class="flex gap-3 items-start">
              <div class="relative">
                <div
                  class="size-16 rounded-lg overflow-hidden border border-dashed transition-colors cursor-pointer"
                  classList={{
                    "border-text-interactive-base bg-surface-info-base/20": dragOver(),
                    "border-border-base hover:border-border-strong": !dragOver(),
                  }}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => document.getElementById("icon-upload")?.click()}
                >
                  <Show
                    when={store.iconUrl}
                    fallback={
                      <div class="size-full flex items-center justify-center">
                        <Avatar
                          fallback={store.name || defaultName()}
                          {...getAvatarColors(store.color)}
                          class="size-full"
                        />
                      </div>
                    }
                  >
                    <img src={store.iconUrl} alt="Project icon" class="size-full object-cover" />
                  </Show>
                </div>
                <Show when={store.iconUrl}>
                  <button
                    type="button"
                    class="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-surface-raised-base border border-border-base flex items-center justify-center hover:bg-surface-raised-base-hover"
                    onClick={clearIcon}
                  >
                    <Icon name="close" class="size-3 text-icon-base" />
                  </button>
                </Show>
              </div>
              <input id="icon-upload" type="file" accept="image/*" class="hidden" onChange={handleInputChange} />
              <div class="flex flex-col gap-1.5 text-12-regular text-text-weak">
                <span>Click or drag an image</span>
                <span>Recommended: 128x128px</span>
              </div>
            </div>
          </div>

          <Show when={!store.iconUrl}>
            <div class="flex flex-col gap-2">
              <label class="text-12-medium text-text-weak">Color</label>
              <div class="flex gap-2">
                <For each={AVATAR_COLOR_KEYS}>
                  {(color) => (
                    <button
                      type="button"
                      class="relative size-8 rounded-md transition-all"
                      classList={{
                        "ring-2 ring-offset-2 ring-offset-surface-base ring-text-interactive-base":
                          store.color === color,
                      }}
                      style={{ background: getAvatarColors(color).background }}
                      onClick={() => setStore("color", color)}
                    >
                      <Avatar fallback={store.name || defaultName()} {...getAvatarColors(color)} class="size-full" />
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={store.saving}>
            {store.saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

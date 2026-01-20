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
    iconUrl: props.project.icon?.override || "",
    saving: false,
  })

  const [dragOver, setDragOver] = createSignal(false)
  const [iconHover, setIconHover] = createSignal(false)

  function handleFileSelect(file: File) {
    if (!file.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setStore("iconUrl", e.target?.result as string)
      setIconHover(false)
    }
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
      icon: { color: store.color, override: store.iconUrl },
    })
    setStore("saving", false)
    dialog.close()
  }

  return (
    <Dialog title="Edit project" class="w-full max-w-[480px] mx-auto">
      <form onSubmit={handleSubmit} class="flex flex-col gap-6 p-6 pt-0">
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
              <div class="relative" onMouseEnter={() => setIconHover(true)} onMouseLeave={() => setIconHover(false)}>
                <div
                  class="relative size-16 rounded-md transition-colors cursor-pointer"
                  classList={{
                    "border-text-interactive-base bg-surface-info-base/20": dragOver(),
                    "border-border-base hover:border-border-strong": !dragOver(),
                    "overflow-hidden": !!store.iconUrl,
                  }}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => {
                    if (store.iconUrl && iconHover()) {
                      clearIcon()
                    } else {
                      document.getElementById("icon-upload")?.click()
                    }
                  }}
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
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "64px",
                    height: "64px",
                    background: "rgba(0,0,0,0.6)",
                    "border-radius": "6px",
                    "z-index": 10,
                    "pointer-events": "none",
                    opacity: iconHover() && !store.iconUrl ? 1 : 0,
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "center",
                  }}
                >
                  <Icon name="cloud-upload" size="large" class="text-icon-invert-base" />
                </div>
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "64px",
                    height: "64px",
                    background: "rgba(0,0,0,0.6)",
                    "border-radius": "6px",
                    "z-index": 10,
                    "pointer-events": "none",
                    opacity: iconHover() && store.iconUrl ? 1 : 0,
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "center",
                  }}
                >
                  <Icon name="trash" size="large" class="text-icon-invert-base" />
                </div>
              </div>
              <input id="icon-upload" type="file" accept="image/*" class="hidden" onChange={handleInputChange} />
              <div class="flex flex-col gap-1.5 text-12-regular text-text-weak self-center">
                <span>Recommended size 128x128px</span>
              </div>
            </div>
          </div>

          <Show when={!store.iconUrl}>
            <div class="flex flex-col gap-2">
              <label class="text-12-medium text-text-weak">Color</label>
              <div class="flex gap-1.5">
                <For each={AVATAR_COLOR_KEYS}>
                  {(color) => (
                    <button
                      type="button"
                      classList={{
                        "flex items-center justify-center size-10 p-0.5 rounded-lg overflow-hidden transition-colors cursor-default": true,
                        "bg-transparent border-2 border-icon-strong-base hover:bg-surface-base-hover":
                          store.color === color,
                        "bg-transparent border border-transparent hover:bg-surface-base-hover hover:border-border-weak-base":
                          store.color !== color,
                      }}
                      onClick={() => setStore("color", color)}
                    >
                      <Avatar
                        fallback={store.name || defaultName()}
                        {...getAvatarColors(color)}
                        class="size-full rounded"
                      />
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

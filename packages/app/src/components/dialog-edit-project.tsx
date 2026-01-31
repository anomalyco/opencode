import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { Icon } from "@opencode-ai/ui/icon"
import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { type LocalProject, getAvatarColors } from "@/context/layout"
import { getFilename } from "@opencode-ai/util/path"
import { Avatar } from "@opencode-ai/ui/avatar"
import { useLanguage } from "@/context/language"

const AVATAR_COLOR_KEYS = ["pink", "mint", "orange", "purple", "cyan", "lime"] as const

export function DialogEditProject(props: { project: LocalProject }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()

  const folderName = createMemo(() => getFilename(props.project.worktree))
  const defaultName = createMemo(() => props.project.name || folderName())

  const [store, setStore] = createStore({
    name: defaultName(),
    color: props.project.icon?.color || "pink",
    iconUrl: props.project.icon?.override || "",
    startup: props.project.commands?.start ?? "",
    saving: false,
    dragOver: false,
    iconHover: false,
  })

  function handleFileSelect(file: File) {
    if (!file.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setStore("iconUrl", e.target?.result as string)
      setStore("iconHover", false)
    }
    reader.readAsDataURL(file)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setStore("dragOver", false)
    const file = e.dataTransfer?.files[0]
    if (file) handleFileSelect(file)
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    setStore("dragOver", true)
  }

  function handleDragLeave() {
    setStore("dragOver", false)
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

    setStore("saving", true)
    const name = store.name.trim() === folderName() ? "" : store.name.trim()
    const start = store.startup.trim()

    if (props.project.id && props.project.id !== "global") {
      await globalSDK.client.project.update({
        projectID: props.project.id,
        directory: props.project.worktree,
        name,
        icon: { color: store.color, override: store.iconUrl },
        commands: { start },
      })
      globalSync.project.icon(props.project.worktree, store.iconUrl || undefined)
      setStore("saving", false)
      dialog.close()
      return
    }

    globalSync.project.meta(props.project.worktree, {
      name,
      icon: { color: store.color, override: store.iconUrl || undefined },
      commands: { start: start || undefined },
    })
    setStore("saving", false)
    dialog.close()
  }

  return (
    <Dialog title={language.t("dialog.project.edit.title")} class="w-full max-w-[480px] mx-auto">
      <form onSubmit={handleSubmit} class="flex flex-col gap-6 p-6 pt-0">
        <div class="flex flex-col gap-4">
          <TextField
            autofocus
            type="text"
            label={language.t("dialog.project.edit.name")}
            placeholder={folderName()}
            value={store.name}
            onChange={(v) => setStore("name", v)}
          />

          <div class="flex flex-col gap-2">
            <label class="text-12-medium text-text-weak">{language.t("dialog.project.edit.icon")}</label>
            <div class="flex gap-3 items-start">
              <div
                class="relative"
                onMouseEnter={() => setStore("iconHover", true)}
                onMouseLeave={() => setStore("iconHover", false)}
              >
                <div
                  class="relative size-16 rounded-md transition-colors cursor-pointer"
                  classList={{
                    "border-text-interactive-base bg-surface-info-base/20": store.dragOver,
                    "border-border-base hover:border-border-strong": !store.dragOver,
                    "overflow-hidden": !!store.iconUrl,
                  }}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => {
                    if (store.iconUrl && store.iconHover) {
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
                          class="size-full text-[32px]"
                        />
                      </div>
                    }
                  >
                    <img
                      src={store.iconUrl}
                      alt={language.t("dialog.project.edit.icon.alt")}
                      class="size-full object-cover"
                    />
                  </Show>
                </div>
                <div
                  class="absolute inset-0 size-16 bg-black/60 rounded-[6px] z-10 pointer-events-none flex items-center justify-center transition-opacity"
                  classList={{
                    "opacity-100": store.iconHover && !store.iconUrl,
                    "opacity-0": !(store.iconHover && !store.iconUrl),
                  }}
                >
                  <Icon name="cloud-upload" size="large" class="text-icon-invert-base" />
                </div>
                <div
                  class="absolute inset-0 size-16 bg-black/60 rounded-[6px] z-10 pointer-events-none flex items-center justify-center transition-opacity"
                  classList={{
                    "opacity-100": store.iconHover && !!store.iconUrl,
                    "opacity-0": !(store.iconHover && !!store.iconUrl),
                  }}
                >
                  <Icon name="trash" size="large" class="text-icon-invert-base" />
                </div>
              </div>
              <input id="icon-upload" type="file" accept="image/*" class="hidden" onChange={handleInputChange} />
              <div class="flex flex-col gap-1.5 text-12-regular text-text-weak self-center">
                <span>{language.t("dialog.project.edit.icon.hint")}</span>
                <span>{language.t("dialog.project.edit.icon.recommended")}</span>
              </div>
            </div>
          </div>

          <Show when={!store.iconUrl}>
            <div class="flex flex-col gap-2">
              <label class="text-12-medium text-text-weak">{language.t("dialog.project.edit.color")}</label>
              <div class="flex gap-1.5">
                <For each={AVATAR_COLOR_KEYS}>
                  {(color) => (
                    <button
                      type="button"
                      aria-label={language.t("dialog.project.edit.color.select", { color })}
                      aria-pressed={store.color === color}
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

          <TextField
            multiline
            label={language.t("dialog.project.edit.worktree.startup")}
            description={language.t("dialog.project.edit.worktree.startup.description")}
            placeholder={language.t("dialog.project.edit.worktree.startup.placeholder")}
            value={store.startup}
            onChange={(v) => setStore("startup", v)}
            spellcheck={false}
            class="max-h-40 w-full font-mono text-xs no-scrollbar"
          />
        </div>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={store.saving}>
            {store.saving ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

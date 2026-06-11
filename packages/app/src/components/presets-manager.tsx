import { createSignal, For, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { TextField } from "@opencode-ai/ui/text-field"
import { useI18n } from "@opencode-ai/ui/context"
import type { Preset, PresetsStore } from "@/hooks/use-presets"

interface PresetsManagerProps {
  store: PresetsStore
}

export function PresetsManager(props: PresetsManagerProps) {
  const { t } = useI18n()
  const [editingId, setEditingId] = createSignal<string | null>(null)
  const [editName, setEditName] = createSignal("")
  const [editContent, setEditContent] = createSignal("")
  const [adding, setAdding] = createSignal(false)
  const [newName, setNewName] = createSignal("")
  const [newContent, setNewContent] = createSignal("")

  const startEdit = (preset: Preset) => {
    setEditingId(preset.id)
    setEditName(preset.name)
    setEditContent(preset.content)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName("")
    setEditContent("")
  }

  const saveEdit = () => {
    const id = editingId()
    if (!id) return
    const name = editName().trim()
    const content = editContent().trim()
    if (!name || !content) return
    props.store.update(id, { name, content })
    cancelEdit()
  }

  const startAdd = () => {
    setAdding(true)
    setNewName("")
    setNewContent("")
  }

  const cancelAdd = () => {
    setAdding(false)
    setNewName("")
    setNewContent("")
  }

  const saveAdd = () => {
    const name = newName().trim()
    const content = newContent().trim()
    if (!name || !content) return
    props.store.add(name, content)
    cancelAdd()
  }

  return (
    <Dialog title={t("presets.manage")} size="large">
      <div class="flex flex-col gap-3 p-6">
        <div class="flex items-center justify-between">
          <span class="text-14-regular text-v2-text-text-muted">
            {t("presets.count", { count: props.store.presets().length })}
          </span>
          <Button size="large" variant="secondary" onClick={startAdd}>
            <Icon name="plus-small" size="small" />
            <span>{t("presets.add")}</span>
          </Button>
        </div>

        <Show when={adding()}>
          <div class="flex flex-col gap-2 rounded-lg border border-v2-border-border-base p-2">
            <TextField
              type="text"
              placeholder={t("presets.name")}
              value={newName()}
              onChange={setNewName}
              autofocus
            />
            <TextField
              multiline
              placeholder={t("presets.content.placeholder")}
              value={newContent()}
              onChange={setNewContent}
            />
            <div class="flex justify-end gap-2">
              <Button size="large" variant="ghost" onClick={cancelAdd}>
                {t("common.cancel")}
              </Button>
              <Button size="large" variant="primary" onClick={saveAdd}>
                {t("common.save")}
              </Button>
            </div>
          </div>
        </Show>

        <div class="flex flex-col gap-0.5">
          <For each={props.store.presets()}>
            {(preset) => {
              const isEditing = () => editingId() === preset.id
              return (
                <Show
                  when={isEditing()}
                  fallback={
                    <div class="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-surface-raised-base-hover transition-colors">
                      <div class="min-w-0 flex-1">
                        <div class="text-14-medium text-v2-text-text-strong truncate">
                          {preset.name}
                        </div>
                        <div class="text-13-regular text-v2-text-text-muted truncate">
                          {preset.content}
                        </div>
                      </div>
                      <div class="flex items-center gap-1">
                        <Tooltip value={t("presets.moveUp")}>
                          <IconButton
                            icon="chevron-down"
                            variant="ghost"
                            class="size-6 p-[5px] rotate-180"
                            onClick={() => props.store.moveUp(preset.id)}
                          />
                        </Tooltip>
                        <Tooltip value={t("presets.moveDown")}>
                          <IconButton
                            icon="chevron-down"
                            variant="ghost"
                            class="size-6 p-[5px]"
                            onClick={() => props.store.moveDown(preset.id)}
                          />
                        </Tooltip>
                        <Tooltip value={t("presets.edit")}>
                          <IconButton
                            icon="edit"
                            variant="ghost"
                            class="size-6 p-[5px]"
                            onClick={() => startEdit(preset)}
                          />
                        </Tooltip>
                        <Tooltip value={t("presets.delete")}>
                          <IconButton
                            icon="trash"
                            variant="ghost"
                            class="size-6 p-[5px] text-red-500"
                            onClick={() => props.store.remove(preset.id)}
                          />
                        </Tooltip>
                      </div>
                    </div>
                  }
                >
                  <div class="flex flex-col gap-2 rounded-lg border border-v2-border-border-base p-2">
                    <TextField
                      type="text"
                      placeholder={t("presets.name")}
                      value={editName()}
                      onChange={setEditName}
                    />
                    <TextField
                      multiline
                      placeholder={t("presets.content.placeholder")}
                      value={editContent()}
                      onChange={setEditContent}
                    />
                    <div class="flex justify-end gap-2">
                      <Button size="large" variant="ghost" onClick={cancelEdit}>
                        {t("common.cancel")}
                      </Button>
                      <Button size="large" variant="primary" onClick={saveEdit}>
                        {t("common.save")}
                      </Button>
                    </div>
                  </div>
                </Show>
              )
            }}
          </For>
        </div>

        <Show when={props.store.presets().length === 0 && !adding()}>
          <div class="flex flex-col items-center justify-center py-8 text-v2-text-text-muted">
            <Icon name="checklist" size="large" />
            <span class="mt-2 text-14-regular">{t("presets.empty")}</span>
            <span class="text-13-regular">{t("presets.empty.hint")}</span>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}

import { createSignal, For, Show } from "solid-js"
import { Popover } from "@opencode-ai/ui/popover"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { TextField } from "@opencode-ai/ui/text-field"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useI18n } from "@opencode-ai/ui/context"
import { extractVariables, resolveVariables, type PresetsStore } from "@/hooks/use-presets"
import { PresetsManager } from "./presets-manager"

interface PresetsPopoverProps {
  store: PresetsStore
  onInsert: (text: string) => void
}

export function PresetsPopover(props: PresetsPopoverProps) {
  const dialog = useDialog()
  const { t } = useI18n()
  const [open, setOpen] = createSignal(false)
  const [pendingVariables, setPendingVariables] = createSignal<string[] | null>(null)
  const [pendingContent, setPendingContent] = createSignal("")
  const [pendingName, setPendingName] = createSignal("")
  const [varValues, setVarValues] = createSignal<Record<string, string>>({})
  const [currentVarIndex, setCurrentVarIndex] = createSignal(0)

  const handleSelect = (name: string, content: string) => {
    const vars = extractVariables(content)
    if (vars.length === 0) {
      props.onInsert(content)
      setOpen(false)
      return
    }
    setPendingVariables(vars)
    setPendingContent(content)
    setPendingName(name)
    setVarValues({})
    setCurrentVarIndex(0)
  }

  const handleVarInput = (value: string) => {
    const vars = pendingVariables()
    if (!vars) return
    const idx = currentVarIndex()
    const key = vars[idx]
    setVarValues((prev) => ({ ...prev, [key]: value }))
  }

  const confirmVariable = () => {
    const vars = pendingVariables()
    if (!vars) return
    const idx = currentVarIndex()
    if (idx < vars.length - 1) {
      setCurrentVarIndex(idx + 1)
    } else {
      const resolved = resolveVariables(pendingContent(), varValues())
      props.onInsert(resolved)
      setOpen(false)
      resetPending()
    }
  }

  const resetPending = () => {
    setPendingVariables(null)
    setPendingContent("")
    setPendingName("")
    setVarValues({})
    setCurrentVarIndex(0)
  }

  const cancelPending = () => {
    resetPending()
  }

  const openManager = () => {
    setOpen(false)
    dialog.show(() => <PresetsManager store={props.store} />)
  }

  return (
    <Popover
      open={open()}
      onOpenChange={setOpen}
      gutter={8}
      placement="top-start"
      trigger={
        <Tooltip value={t("presets.title")}>
          <IconButton
            data-action="prompt-presets"
            type="button"
            icon="checklist"
            variant="ghost"
            class="size-7 rounded-md p-[6px] text-v2-icon-icon-muted"
            aria-label={t("presets.title")}
          />
        </Tooltip>
      }
    >
      <div class="flex w-[280px] flex-col">
        <Show when={!pendingVariables()}>
          <div class="max-h-[300px] overflow-y-auto flex flex-col gap-0.5 p-1">
            <For each={props.store.presets()}>
              {(preset) => (
                <button
                  type="button"
                  class="flex w-full flex-col gap-0.5 rounded-md px-2 py-1 text-left hover:bg-surface-raised-base-hover transition-colors"
                  onClick={() => handleSelect(preset.name, preset.content)}
                >
                  <span class="text-14-medium text-v2-text-text-strong truncate">
                    {preset.name}
                  </span>
                  <span class="text-13-regular text-v2-text-text-muted truncate">
                    {preset.content}
                  </span>
                </button>
              )}
            </For>
            <Show when={props.store.presets().length === 0}>
              <div class="flex flex-col items-center justify-center py-6 text-v2-text-text-muted">
                <span class="text-13-regular">{t("presets.empty")}</span>
              </div>
            </Show>
          </div>
          <div class="border-t border-v2-border-border p-1">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-md px-2 py-1 text-13-regular text-v2-text-text-muted hover:bg-surface-raised-base-hover transition-colors"
              onClick={openManager}
            >
              <Icon name="settings-gear" size="small" />
              {t("presets.manage")}
            </button>
          </div>
        </Show>

        <Show when={pendingVariables()}>
          <div class="flex flex-col gap-2 px-1 py-2">
            <div class="text-14-medium text-v2-text-text-strong px-2">
              {t("presets.variables.title", { name: pendingName() })}
            </div>
            <div class="text-13-regular text-v2-text-text-muted px-2">
              {pendingVariables()![currentVarIndex()]}（{currentVarIndex() + 1}/{pendingVariables()!.length}）
            </div>
            <TextField
              type="text"
              placeholder={pendingVariables()![currentVarIndex()]}
              value={varValues()[pendingVariables()![currentVarIndex()]] ?? ""}
              onChange={(value) => handleVarInput(value)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === "Enter") confirmVariable()
                if (e.key === "Escape") cancelPending()
              }}
              class="mx-1 w-[calc(100%-8px)]"
              autofocus
            />
            <div class="flex justify-end gap-2 px-1">
              <Button size="large" variant="ghost" onClick={cancelPending}>
                {t("common.cancel")}
              </Button>
              <Button size="large" variant="primary" onClick={confirmVariable}>
                {currentVarIndex() < pendingVariables()!.length - 1 ? t("presets.variables.next") : t("presets.variables.insert")}
              </Button>
            </div>
          </div>
        </Show>
      </div>
    </Popover>
  )
}

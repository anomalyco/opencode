import { createMemo, createSignal, For, Show, type Component } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"

export type ModelRaceModelOption = {
  id: string
  title: string
  provider: string
}

export const ModelRaceModelsDialog: Component<{
  options: ModelRaceModelOption[]
  selected: string[]
  onSave: (models: string[]) => Promise<boolean> | boolean
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const [filter, setFilter] = createSignal("")
  const [selected, setSelected] = createSignal(new Set(props.selected))
  const [saving, setSaving] = createSignal(false)

  const filtered = createMemo(() => {
    const query = filter().trim().toLowerCase()
    if (!query) return props.options
    return props.options.filter((model) => `${model.provider} ${model.title} ${model.id}`.toLowerCase().includes(query))
  })

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    const saved = await props.onSave([...selected()])
    setSaving(false)
    if (saved || saved === undefined) dialog.close()
  }

  return (
    <Dialog size="large" transition class="min-h-0">
      <div class="flex h-[min(70vh,520px)] min-h-0 flex-col gap-4 p-6">
        <div class="flex shrink-0 flex-col gap-1">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.general.modelRace.models.title")}</h2>
          <p class="text-12-regular text-text-weak">{language.t("settings.general.modelRace.models.description")}</p>
        </div>

        <div class="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-surface-base px-3">
          <Icon name="magnifying-glass" class="text-icon-weak-base flex-shrink-0" />
          <TextField
            variant="ghost"
            type="text"
            value={filter()}
            onChange={setFilter}
            placeholder={language.t("dialog.model.search.placeholder")}
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
            class="flex-1"
          />
          <Show when={filter()}>
            <button class="text-text-weak" onClick={() => setFilter("")}>
              <Icon name="circle-x" />
            </button>
          </Show>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto border-y border-border-weak-base">
          <For each={filtered()}>
            {(model) => (
              <div
                role="button"
                tabIndex={0}
                class="flex cursor-pointer select-none items-center justify-between gap-4 border-b border-border-weak-base py-3 pr-3 transition-colors last:border-none hover:bg-surface-base focus-visible:bg-surface-base focus-visible:outline-none"
                onClick={(event) => {
                  if (event.target instanceof Element && event.target.closest('[data-component="switch"]')) return
                  toggle(model.id)
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return
                  event.preventDefault()
                  toggle(model.id)
                }}
              >
                <div class="min-w-0 flex flex-col">
                  <span class="text-14-regular text-text-strong truncate">{model.title}</span>
                  <span class="text-12-regular text-text-weak truncate">{model.provider}</span>
                </div>
                <Switch checked={selected().has(model.id)} onChange={() => toggle(model.id)} hideLabel>
                  {model.title}
                </Switch>
              </div>
            )}
          </For>
          <Show when={filtered().length === 0}>
            <div class="py-8 text-center text-14-regular text-text-weak">{language.t("dialog.model.empty")}</div>
          </Show>
        </div>

        <div class="flex shrink-0 items-center justify-between gap-4">
          <span class="text-12-regular text-text-weak">
            {language.t("settings.general.modelRace.models.selected", { count: selected().size })}
          </span>
          <div class="flex items-center gap-2">
            <Button variant="ghost" disabled={saving()} onClick={() => dialog.close()}>
              {language.t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={saving()} onClick={save}>
              {saving() ? language.t("common.saving") : language.t("common.save")}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

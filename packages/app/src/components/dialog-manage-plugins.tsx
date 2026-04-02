import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import type { Config } from "@opencode-ai/sdk/v2"

type PluginItem = NonNullable<Config["plugin"]>[number]

function spec(item: PluginItem) {
  return typeof item === "string" ? item : item[0]
}

export function DialogManagePlugins() {
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const [state, setState] = createStore({
    spec: "",
    busy: false,
    changed: false,
  })

  const list = createMemo(() => {
    const plugins = globalSync.data.config.plugin ?? []
    return plugins.map((item, index) => ({
      index,
      item,
      spec: spec(item),
    }))
  })

  const setPlugins = async (next: NonNullable<Config["plugin"]>, before: NonNullable<Config["plugin"]>) => {
    globalSync.set("config", "plugin", next)
    await globalSync.updateConfig({ plugin: next }).catch((err) => {
      globalSync.set("config", "plugin", before)
      throw err
    })
  }

  const invalid = createMemo(() => {
    const value = state.spec.trim()
    if (!value) return false
    if (value.includes(" ")) return true
    return false
  })

  const add = async () => {
    if (state.busy) return
    const input = state.spec.trim()
    if (!input) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: language.t("dialog.plugins.specRequired"),
      })
      return
    }

    if (invalid()) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: language.t("dialog.plugins.specInvalid"),
      })
      return
    }

    const before = globalSync.data.config.plugin ?? []
    const has = before.some((item) => spec(item) === input)
    if (has) {
      showToast({
        variant: "error",
        title: language.t("dialog.plugins.exists"),
      })
      return
    }

    setState("busy", true)
    const next = [...before, input]
    await setPlugins(next, before)
      .then(() => {
        setState("spec", "")
        setState("changed", true)
        showToast({
          variant: "success",
          title: language.t("dialog.plugins.added"),
        })
      })
      .catch((err) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => {
        setState("busy", false)
      })
  }

  const remove = async (index: number) => {
    if (state.busy) return
    const before = globalSync.data.config.plugin ?? []
    const next = before.filter((_, i) => i !== index)
    if (next.length === before.length) return

    setState("busy", true)
    await setPlugins(next, before)
      .then(() => {
        setState("changed", true)
        showToast({
          variant: "success",
          title: language.t("dialog.plugins.removed"),
        })
      })
      .catch((err) => {
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => {
        setState("busy", false)
      })
  }

  return (
    <Dialog title={language.t("dialog.plugins.manage.title")}>
      <div class="flex flex-col gap-3 px-5 pb-5">
        <div class="bg-surface-base rounded-md p-3 flex flex-col gap-3">
          <TextField
            type="text"
            label={language.t("dialog.plugins.specLabel")}
            placeholder={language.t("dialog.plugins.specPlaceholder")}
            value={state.spec}
            disabled={state.busy}
            autofocus
            validationState={invalid() ? "invalid" : "valid"}
            error={invalid() ? language.t("dialog.plugins.specInvalid") : undefined}
            onChange={(value) => setState("spec", value)}
            onKeyDown={(evt: KeyboardEvent) => {
              evt.stopPropagation()
              if (evt.key !== "Enter" || evt.isComposing) return
              evt.preventDefault()
              void add()
            }}
          />
          <div class="flex justify-end">
            <Button size="large" variant="secondary" icon="plus-small" disabled={state.busy} onClick={() => void add()}>
              {language.t("dialog.plugins.add")}
            </Button>
          </div>
        </div>

        {state.changed && (
          <div class="rounded-md bg-surface-raised-base px-3 py-2 text-12-regular text-text-weak">
            {language.t("dialog.plugins.restartHint")}
          </div>
        )}

        <div class="bg-surface-base rounded-md p-2 max-h-72 overflow-y-auto">
          <div class="text-12-regular text-text-weak px-2 pb-2">{language.t("dialog.plugins.listTitle")}</div>
          <div class="flex flex-col">
            {list().map((item) => (
              <div class="flex items-center justify-between gap-3 py-1.5 px-2 border-b border-border-weak-base last:border-b-0">
                <span class="text-13-regular text-text-base truncate">{item.spec}</span>
                <Button size="small" variant="ghost" disabled={state.busy} onClick={() => void remove(item.index)}>
                  {language.t("common.delete")}
                </Button>
              </div>
            ))}
            {list().length === 0 && (
              <div class="text-13-regular text-text-weak px-2 py-3">{language.t("dialog.plugins.empty")}</div>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  )
}

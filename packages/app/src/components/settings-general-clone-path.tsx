import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { Show, createEffect, createMemo, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsList } from "./settings-list"
import { SettingsRow } from "./settings-row"

export function SettingsGeneralClonePath() {
  const language = useLanguage()
  const platform = usePlatform()

  const enabled = createMemo(
    () => platform.platform === "desktop" && !!platform.getDefaultCloneDirectory && !!platform.setDefaultCloneDirectory,
  )
  const [state, setState] = createStore({
    path: "",
    busy: false,
    dirty: false,
  })
  const [dir, acts] = createResource(() => (enabled() ? platform.getDefaultCloneDirectory?.() : null))

  createEffect(() => {
    const path = dir.latest
    if (!path) return
    if (state.dirty) return
    setState("path", path)
  })

  const save = async () => {
    const set = platform.setDefaultCloneDirectory
    if (!set) return
    setState("busy", true)
    const path = state.path.trim()
    await Promise.resolve()
      .then(async () => {
        await set(path || null)
        setState("dirty", false)
        await acts.refetch()
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: msg })
      })
      .finally(() => setState("busy", false))
  }

  const reset = async () => {
    const set = platform.setDefaultCloneDirectory
    if (!set) return
    setState("busy", true)
    await Promise.resolve()
      .then(async () => {
        await set(null)
        setState("dirty", false)
        await acts.refetch()
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: msg })
      })
      .finally(() => setState("busy", false))
  }

  const choose = async () => {
    if (!platform.openDirectoryPickerDialog) return
    const res = await platform.openDirectoryPickerDialog({
      title: language.t("settings.desktop.clonePath.title"),
      multiple: false,
    })
    const path = Array.isArray(res) ? res[0] : res
    if (!path) return
    setState("path", path)
    setState("dirty", true)
  }

  return (
    <Show when={enabled()}>
      <div class="flex flex-col gap-1">
        <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.desktop.section.projects")}</h3>

        <div class="bg-surface-raised-base px-4 rounded-lg">
          <SettingsList>
            <SettingsRow
              title={language.t("settings.desktop.clonePath.title")}
              description={language.t("settings.desktop.clonePath.description")}
            >
              <div class="flex items-center gap-2 min-w-[320px]">
                <TextField
                  value={state.path}
                  placeholder={language.t("settings.desktop.clonePath.placeholder")}
                  class="w-full"
                  onChange={(value: string) => {
                    setState("path", value)
                    setState("dirty", true)
                  }}
                />
                <Button type="button" variant="ghost" size="small" onClick={choose} disabled={state.busy}>
                  {language.t("dialog.project.open.path.browse")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  onClick={save}
                  disabled={state.busy || !state.dirty}
                >
                  {language.t("common.save")}
                </Button>
                <Button type="button" variant="ghost" size="small" onClick={reset} disabled={state.busy}>
                  {language.t("common.reset")}
                </Button>
              </div>
            </SettingsRow>
          </SettingsList>
        </div>
      </div>
    </Show>
  )
}

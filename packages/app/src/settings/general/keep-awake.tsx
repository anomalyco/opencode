import { createResource } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import { Switch } from "@opencode-ai/ui/switch"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { SettingsRow } from "@/settings/row"
import { showToast } from "@/shell/notifications/toast"

export function KeepAwakeSetting() {
  const platform = usePlatform()
  const language = useLanguage()
  const get = platform.getKeepAwakeEnabled
  const set = platform.setKeepAwakeEnabled
  if (!get || !set) return null

  const [state, setState] = createStore({ saving: false })
  const failed = () => {
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("settings.general.row.keepAwake.error"),
    })
  }
  const [enabled, { mutate, refetch }] = createResource(() => get().catch(failed))
  makeEventListener(window, "focus", () => {
    if (!state.saving) void refetch()
  })

  const change = (checked: boolean) => {
    const previous = enabled.latest
    setState("saving", true)
    mutate(checked)
    void set(checked)
      .catch(() => {
        mutate(previous)
        failed()
      })
      .finally(() => setState("saving", false))
  }

  return (
    <SettingsRow
      title={language.t("settings.general.row.keepAwake.title")}
      description={language.t("settings.general.row.keepAwake.description")}
    >
      <div data-action="settings-keep-awake">
        <Switch
          aria-label={language.t("settings.general.row.keepAwake.title")}
          checked={enabled.latest === true}
          disabled={enabled.loading || enabled.latest === undefined || state.saving}
          onChange={change}
          hideLabel
        >
          {language.t("settings.general.row.keepAwake.title")}
        </Switch>
      </div>
    </SettingsRow>
  )
}

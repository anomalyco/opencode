import { usePlugin } from "@opencode/plugin/gui"
import type Review from "./index"

/** The narrow-screen diff wrap row of the host's General settings section. */
export default function WrapLinesRow() {
  const ctx = usePlugin<typeof Review>()
  const ui = ctx.ui
  const mobileDiff = ctx.stores.mobileDiff

  return (
    <ui.SettingsRow
      id="settings-mobile-diff-wrap"
      title={ctx.t("settings.wrapLines.title")}
      description={ctx.t("settings.wrapLines.description")}
    >
      <ui.Switch
        label={ctx.t("settings.wrapLines.title")}
        hideLabel
        checked={mobileDiff.value.wrap}
        onChange={(checked) =>
          mobileDiff.update((draft) => {
            draft.wrap = checked
          })
        }
      />
    </ui.SettingsRow>
  )
}

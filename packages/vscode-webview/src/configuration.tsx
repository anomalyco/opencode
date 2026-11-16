import { createEffect, createSignal, onCleanup, untrack } from "solid-js"
import { timelinePreset, timelinePresets, useSettings } from "@opencode/app/vscode"
import type { Configuration, HostMessage } from "../../../sdks/vscode/src/webview-protocol"
import { bootstrap } from "./bootstrap"

/**
 * Applies the extension's VS Code settings to the app's preferences, on load and whenever they change. They replace the
 * app's Settings screen, so nothing in the webview changes these preferences otherwise.
 */
export function ConfigurationSync() {
  const settings = useSettings()
  const [configuration, setConfiguration] = createSignal(bootstrap.configuration)

  const receive = (event: MessageEvent<HostMessage>) => {
    if (event.data.type === "configuration") setConfiguration(event.data.configuration)
  }
  window.addEventListener("message", receive)
  onCleanup(() => window.removeEventListener("message", receive))

  createEffect(() => {
    if (!settings.ready()) return
    const values = configuration()
    untrack(() => apply(settings, values))
  })

  return null
}

function apply(settings: ReturnType<typeof useSettings>, values: Configuration) {
  settings.general.setFollowUpBehavior(values.followUpBehavior)
  settings.permissions.setAutoApproveDefault(values.autoAcceptPermissions)
  settings.general.setShowCustomAgents(values.showAgent)
  settings.general.setShowTurnDiffs(values["timeline.changedFiles"])
  settings.notifications.setAgent(values["notifications.agent"])
  settings.notifications.setPermissions(values["notifications.permissions"])
  settings.notifications.setQuestions(values["notifications.questions"])
  settings.notifications.setErrors(values["notifications.errors"])
  settings.sounds.setAgentEnabled(values["sounds.agent"])
  settings.sounds.setPermissionsEnabled(values["sounds.permissions"])
  settings.sounds.setQuestionsEnabled(values["sounds.questions"])
  settings.sounds.setErrorsEnabled(values["sounds.errors"])
  settings.sounds.setInterfaceEnabled(values["sounds.interface"])
  settings.appearance.setReduceMotion(values.reduceMotion === "auto" ? "system" : values.reduceMotion)

  // The preset's placements are copied into the stored value, so only replace them when the preset changed.
  const preset = timelinePresets.find((item) => item.id === values["timeline.detail"])
  if (preset && timelinePreset(settings.general.timelineDetail())?.id !== preset.id)
    settings.general.setTimelineDetail({ ...preset.value })
}

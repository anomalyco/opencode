import { DialogBody, DialogHeader, DialogTitleGroup, DialogV2 } from "@opencode-ai/ui/v2/dialog-v2"
import { useLanguage } from "@/context/language"
import { SettingsModelRaceV2 } from "./settings-v2/model-race"

export function DialogModelRaceSettings() {
  const language = useLanguage()

  return (
    <DialogV2 size="large" variant="settings">
      <DialogHeader>
        <DialogTitleGroup
          title={language.t("session.modelRace.manageTitle")}
          description={language.t("session.modelRace.manageDescription")}
        />
      </DialogHeader>
      <DialogBody class="overflow-y-auto p-6">
        <SettingsModelRaceV2 titleIndent />
      </DialogBody>
    </DialogV2>
  )
}

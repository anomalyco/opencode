import { type Component } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { ModelRaceModelsDialog } from "../settings-model-race-models"
import { useModelRaceSettings } from "../settings-model-race-controller"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

export const SettingsModelRaceV2: Component<{ titleIndent?: boolean }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const race = useModelRaceSettings()

  const selectModels = () => {
    void dialog.push(() => (
      <ModelRaceModelsDialog
        options={race.options()}
        selected={race.draft().models}
        onSave={(models) => race.saveModels(models)}
      />
    ))
  }

  return (
    <div class="settings-v2-section">
      <h3 class="settings-v2-section-title" classList={{ "pl-5": props.titleIndent === true }}>
        {language.t("settings.general.section.modelRace")}
      </h3>
      <SettingsListV2>
        <SettingsRowV2
          title={language.t("settings.general.modelRace.enabled.title")}
          description={language.t("settings.general.modelRace.enabled.description")}
        >
          <Switch checked={race.draft().enabled} onChange={race.setEnabled} />
        </SettingsRowV2>
        <SettingsRowV2
          title={language.t("settings.general.modelRace.models.title")}
          description={language.t("settings.general.modelRace.models.selected", { count: race.draft().models.length })}
        >
          <ButtonV2 variant="neutral" onClick={selectModels}>
            {language.t("settings.general.modelRace.models.select")}
          </ButtonV2>
        </SettingsRowV2>
        <SettingsRowV2
          title={language.t("settings.general.modelRace.firstToken.title")}
          description={language.t("settings.general.modelRace.firstToken.description")}
        >
          <Switch checked={race.draft().strategy.firstToken} onChange={race.setFirstToken} />
        </SettingsRowV2>
        <SettingsRowV2
          title={language.t("settings.general.modelRace.throughput.title")}
          description={language.t("settings.general.modelRace.throughput.description")}
        >
          <Switch checked={race.draft().strategy.throughput} onChange={race.setThroughput} />
        </SettingsRowV2>
        <SettingsRowV2
          title={language.t("settings.general.modelRace.toolCall.title")}
          description={language.t("settings.general.modelRace.toolCall.description")}
        >
          <Switch checked={race.draft().strategy.toolCall} onChange={race.setToolCall} />
        </SettingsRowV2>
        <SettingsRowV2
          title={language.t("settings.general.modelRace.warmup.title")}
          description={language.t("settings.general.modelRace.warmup.description")}
        >
          <div class="w-28">
            <TextInputV2
              type="number"
              appearance="base"
              value={String(race.draft().throughput.warmupTokens)}
              min={1}
              onInput={(event) => {
                const next = Number(event.currentTarget.value)
                if (Number.isInteger(next) && next > 0) race.setWarmupTokens(next)
              }}
            />
          </div>
        </SettingsRowV2>
        <SettingsRowV2
          title={language.t("settings.general.modelRace.window.title")}
          description={language.t("settings.general.modelRace.window.description")}
        >
          <div class="w-28">
            <TextInputV2
              type="number"
              appearance="base"
              value={String(race.draft().throughput.measurementWindowMs)}
              min={1}
              onInput={(event) => {
                const next = Number(event.currentTarget.value)
                if (Number.isInteger(next) && next > 0) race.setMeasurementWindow(next)
              }}
            />
          </div>
        </SettingsRowV2>
        <SettingsRowV2
          title={language.t("settings.general.modelRace.switch.title")}
          description={language.t("settings.general.modelRace.switch.description")}
        >
          <Switch checked={race.draft().switch.enabled} onChange={race.setSwitch} />
        </SettingsRowV2>
      </SettingsListV2>

      <div class="flex items-center justify-between gap-4 pt-3">
        <span class="settings-v2-help-text">
          {race.errors()[0] ?? (race.dirty() ? language.t("settings.general.modelRace.unsaved") : "")}
        </span>
        <div class="flex items-center gap-2">
          <ButtonV2 variant="ghost-muted" disabled={!race.dirty()} onClick={race.reset}>
            {language.t("settings.general.modelRace.action.reset")}
          </ButtonV2>
          <ButtonV2
            variant="contrast"
            disabled={!race.dirty() || race.errors().length > 0 || race.saving()}
            onClick={race.save}
          >
            {race.saving() ? language.t("common.saving") : language.t("common.save")}
          </ButtonV2>
        </div>
      </div>
    </div>
  )
}

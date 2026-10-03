import { Show, type Component, type JSX } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { SettingsList } from "./settings-list"
import { ModelRaceModelsDialog } from "./settings-model-race-models"
import { useModelRaceSettings } from "./settings-model-race-controller"

export const SettingsModelRace: Component = () => {
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
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.modelRace")}</h3>
      <SettingsList>
        <RaceRow
          title={language.t("settings.general.modelRace.enabled.title")}
          description={language.t("settings.general.modelRace.enabled.description")}
        >
          <Switch checked={race.draft().enabled} onChange={race.setEnabled} />
        </RaceRow>
        <RaceRow
          title={language.t("settings.general.modelRace.models.title")}
          description={language.t("settings.general.modelRace.models.selected", { count: race.draft().models.length })}
        >
          <Button variant="secondary" onClick={selectModels}>
            {language.t("settings.general.modelRace.models.select")}
          </Button>
        </RaceRow>
        <RaceRow
          title={language.t("settings.general.modelRace.firstToken.title")}
          description={language.t("settings.general.modelRace.firstToken.description")}
        >
          <Switch checked={race.draft().strategy.firstToken} onChange={race.setFirstToken} />
        </RaceRow>
        <RaceRow
          title={language.t("settings.general.modelRace.throughput.title")}
          description={language.t("settings.general.modelRace.throughput.description")}
        >
          <Switch checked={race.draft().strategy.throughput} onChange={race.setThroughput} />
        </RaceRow>
        <RaceRow
          title={language.t("settings.general.modelRace.toolCall.title")}
          description={language.t("settings.general.modelRace.toolCall.description")}
        >
          <Switch checked={race.draft().strategy.toolCall} onChange={race.setToolCall} />
        </RaceRow>
        <RaceRow
          title={language.t("settings.general.modelRace.warmup.title")}
          description={language.t("settings.general.modelRace.warmup.description")}
        >
          <TextField
            type="number"
            variant="normal"
            value={String(race.draft().throughput.warmupTokens)}
            min={1}
            class="w-28"
            onChange={(value) => {
              const next = Number(value)
              if (Number.isInteger(next) && next > 0) race.setWarmupTokens(next)
            }}
          />
        </RaceRow>
        <RaceRow
          title={language.t("settings.general.modelRace.window.title")}
          description={language.t("settings.general.modelRace.window.description")}
        >
          <TextField
            type="number"
            variant="normal"
            value={String(race.draft().throughput.measurementWindowMs)}
            min={1}
            class="w-28"
            onChange={(value) => {
              const next = Number(value)
              if (Number.isInteger(next) && next > 0) race.setMeasurementWindow(next)
            }}
          />
        </RaceRow>
        <RaceRow
          title={language.t("settings.general.modelRace.switch.title")}
          description={language.t("settings.general.modelRace.switch.description")}
        >
          <Switch checked={race.draft().switch.enabled} onChange={race.setSwitch} />
        </RaceRow>
      </SettingsList>

      <div class="flex items-center justify-between gap-4 pt-3">
        <span class="text-12-regular text-text-weak">
          {race.errors()[0] ?? (race.dirty() ? language.t("settings.general.modelRace.unsaved") : "")}
        </span>
        <div class="flex items-center gap-2">
          <Button variant="ghost" disabled={!race.dirty()} onClick={race.reset}>
            {language.t("settings.general.modelRace.action.reset")}
          </Button>
          <Button
            variant="primary"
            disabled={!race.dirty() || race.errors().length > 0 || race.saving()}
            onClick={race.save}
          >
            {race.saving() ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  )
}

function RaceRow(props: { title: string; description: string; children: JSX.Element }) {
  return (
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}

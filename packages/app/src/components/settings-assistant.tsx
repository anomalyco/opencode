import { Select } from "@opencode-ai/ui/select"
import type { Component } from "solid-js"
import { createMemo } from "solid-js"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useSettings } from "@/context/settings"
import { SettingsList } from "./settings-list"

export const SettingsAssistant: Component = () => {
  const language = useLanguage()
  const models = useModels()
  const settings = useSettings()

  const list = createMemo(() =>
    models
      .list()
      .map((item) => ({
        value: { providerID: item.provider.id, modelID: item.id },
        label: `${item.provider.name} - ${item.name}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  )

  const options = createMemo(() => [
    {
      value: undefined,
      label: language.t("settings.assistant.model.option.auto"),
    },
    ...list(),
  ])

  const current = createMemo(() => {
    const selected = settings.assistant.model()
    if (!selected) return options()[0]
    return (
      options().find(
        (item) => item.value?.providerID === selected.providerID && item.value?.modelID === selected.modelID,
      ) ?? options()[0]
    )
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="flex flex-col gap-6 pt-6 max-w-[720px]">
        <div class="flex flex-col gap-1">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.assistant.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.assistant.description")}</p>
        </div>

        <SettingsList>
          <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="text-14-medium text-text-strong">{language.t("settings.assistant.model.title")}</span>
              <span class="text-12-regular text-text-weak">{language.t("settings.assistant.model.description")}</span>
            </div>
            <div class="flex w-full justify-end sm:w-auto sm:shrink-0">
              <Select
                data-action="settings-assistant-model"
                options={options()}
                current={current()}
                value={(item) => (item.value ? `${item.value.providerID}/${item.value.modelID}` : "auto")}
                label={(item) => item.label}
                onSelect={(item) => settings.assistant.setModel(item?.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                triggerStyle={{ "min-width": "260px" }}
              />
            </div>
          </div>
        </SettingsList>
      </div>
    </div>
  )
}

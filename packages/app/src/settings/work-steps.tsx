import { Component, createMemo } from "solid-js"
import { Select } from "@opencode/ui/select"
import { useLanguage } from "@/runtime/i18n/language"
import { SettingsRow } from "@/settings/row"
import { type WorkSteps, useSettings } from "@/settings/model"

type WorkStepsKey = keyof WorkSteps

export const WorkStepsSettings: Component = () => {
  const language = useLanguage()
  const settings = useSettings()

  const viewOptions = createMemo(() => [
    { value: "compact" as const, label: language.t("settings.timeline.workSteps.view.compact") },
    { value: "standard" as const, label: language.t("settings.timeline.workSteps.view.standard") },
    { value: "detailed" as const, label: language.t("settings.timeline.workSteps.view.detailed") },
    { value: "verbose" as const, label: language.t("settings.timeline.workSteps.view.verbose") },
  ])

  const collapseTimingOptions = createMemo(() => [
    { value: "completion" as const, label: language.t("settings.timeline.workSteps.collapseTiming.completion") },
    { value: "next-input" as const, label: language.t("settings.timeline.workSteps.collapseTiming.nextInput") },
  ])

  const foldedRepliesOptions = createMemo(() => [
    { value: "all" as const, label: language.t("settings.timeline.workSteps.foldedReplies.all") },
    { value: "final" as const, label: language.t("settings.timeline.workSteps.foldedReplies.final") },
  ])

  const update = <Key extends WorkStepsKey>(key: Key, value: WorkSteps[Key]) => {
    settings.general.setWorkSteps({ ...settings.general.workSteps(), [key]: value })
  }

  return (
    <>
      <SettingsRow
        title={language.t("settings.timeline.workSteps.view.title")}
        description={language.t("settings.timeline.workSteps.view.description")}
      >
        <Select
          data-action="settings-work-steps-view"
          aria-label={language.t("settings.timeline.workSteps.view.title")}
          options={viewOptions()}
          current={viewOptions().find((option) => option.value === settings.general.workSteps().view)}
          value={(option) => option.value}
          label={(option) => option.label}
          placement="bottom-end"
          gutter={6}
          onSelect={(option) => option && update("view", option.value)}
        />
      </SettingsRow>

      <SettingsRow
        title={language.t("settings.timeline.workSteps.collapseTiming.title")}
        description={language.t("settings.timeline.workSteps.collapseTiming.description")}
      >
        <Select
          data-action="settings-work-steps-collapse-timing"
          aria-label={language.t("settings.timeline.workSteps.collapseTiming.title")}
          options={collapseTimingOptions()}
          current={collapseTimingOptions().find(
            (option) => option.value === settings.general.workSteps().collapseTiming,
          )}
          value={(option) => option.value}
          label={(option) => option.label}
          placement="bottom-end"
          gutter={6}
          onSelect={(option) => option && update("collapseTiming", option.value)}
        />
      </SettingsRow>

      <SettingsRow
        title={language.t("settings.timeline.workSteps.foldedReplies.title")}
        description={language.t("settings.timeline.workSteps.foldedReplies.description")}
      >
        <Select
          data-action="settings-work-steps-folded-replies"
          aria-label={language.t("settings.timeline.workSteps.foldedReplies.title")}
          options={foldedRepliesOptions()}
          current={foldedRepliesOptions().find((option) => option.value === settings.general.workSteps().foldedReplies)}
          value={(option) => option.value}
          label={(option) => option.label}
          placement="bottom-end"
          gutter={6}
          onSelect={(option) => option && update("foldedReplies", option.value)}
        />
      </SettingsRow>
    </>
  )
}
